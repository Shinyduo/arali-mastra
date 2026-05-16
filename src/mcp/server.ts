/**
 * MCP server factory + handler.
 * Creates per-session McpServer instances with user context baked in.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context } from "hono";
import { verifyJwt } from "../lib/jwt.js";
import {
  getUserCapabilities,
  getUserOrgUnitIds,
} from "../lib/resolve-user-role.js";
import type { AraliRuntimeContext } from "../mastra/context/types.js";
import { registerAraliTools } from "./tool-bridge.js";
import { MCP_INSTRUCTIONS } from "./instructions.js";

/**
 * Creates an McpServer with all Arali tools registered for a specific user.
 */
function createAraliMcpServer(userContext: AraliRuntimeContext): McpServer {
  const server = new McpServer(
    {
      name: "Arali CRM",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: MCP_INSTRUCTIONS,
    },
  );

  registerAraliTools(server, userContext);
  return server;
}

// Session management
interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

const sessions = new Map<string, McpSession>();

/**
 * Resolves a Bearer JWT into a full AraliRuntimeContext.
 */
async function resolveUserContext(token: string): Promise<AraliRuntimeContext> {
  const claims = await verifyJwt(token);

  const enterpriseId = (claims.selectedEnterpriseId ||
    claims.enterpriseId) as string;
  if (!enterpriseId) {
    throw new Error("No enterprise context in token");
  }

  const userId = claims.sub as string;

  const [capabilities, orgUnitIds] = await Promise.all([
    getUserCapabilities(userId, enterpriseId),
    getUserOrgUnitIds(userId, enterpriseId),
  ]);

  return {
    enterpriseId,
    userId,
    userName: (claims.name || claims.email) as string,
    userEmail: claims.email as string,
    orgUnitIds,
    capabilities,
    jwt: token,
  };
}

/**
 * MCP handler — registered via registerApiRoute as ALL /mcp.
 */
export async function handleMcp(c: Context) {
  const sessionId = c.req.header("mcp-session-id");

  // Reuse existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    const response = await session.transport.handleRequest(c.req.raw);
    return response;
  }

  // New session — authenticate first
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    const BASE_URL = process.env.MCP_BASE_URL ?? "http://localhost:4111";
    // RFC 9728: WWW-Authenticate header points to protected resource metadata
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  let userContext: AraliRuntimeContext;
  try {
    userContext = await resolveUserContext(authHeader.slice(7));
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Create per-session MCP server + transport
  const server = createAraliMcpServer(userContext);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, server });
      userContext.mcpSessionId = id;
      console.log(`MCP session started: ${id} (user: ${userContext.userEmail})`);
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
      console.log(`MCP session closed: ${id}`);
    },
  });

  await server.connect(transport);

  const response = await transport.handleRequest(c.req.raw);
  return response;
}
