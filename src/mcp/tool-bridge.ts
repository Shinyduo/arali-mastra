/**
 * Bridges Mastra tools → MCP tool registrations.
 * Auto-discovers all tools from read/write index exports.
 * Adding a new tool to those indexes automatically makes it available in MCP.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import type { AraliRuntimeContext } from "../mastra/context/types.js";
import * as readTools from "../mastra/tools/read/index.js";
import * as writeTools from "../mastra/tools/write/index.js";

/**
 * Creates a mock requestContext that satisfies extractContext() in rbac.ts.
 * This lets every Mastra tool work unmodified in the MCP context.
 */
function createMockRequestContext(ctx: AraliRuntimeContext) {
  const map = new Map<string, unknown>(Object.entries(ctx));
  return { get: (key: string) => map.get(key) };
}

/**
 * Registers all Arali tools on an McpServer instance.
 * Tools get the user's context baked in via closure — same RBAC, same queries.
 */
export function registerAraliTools(
  server: McpServer,
  userContext: AraliRuntimeContext,
) {
  const mockRequestContext = createMockRequestContext(userContext);

  const allTools = { ...readTools, ...writeTools };

  for (const [, tool] of Object.entries(allTools)) {
    if (!tool || typeof tool !== "object" || !("id" in tool)) continue;

    const mastraTool = tool as {
      id: string;
      description?: string;
      inputSchema?: { shape: ZodRawShape; _def?: { shape: () => ZodRawShape } };
      execute: (input: unknown, context: { requestContext: unknown }) => Promise<unknown>;
    };

    // Extract Zod shape for MCP SDK's registerTool
    // McpServer.registerTool expects a ZodRawShape (Record<string, ZodType>), not z.object()
    const zodShape: ZodRawShape = mastraTool.inputSchema?.shape
      ?? mastraTool.inputSchema?._def?.shape?.()
      ?? {};

    server.registerTool(
      mastraTool.id,
      {
        description: mastraTool.description ?? "",
        inputSchema: zodShape,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await mastraTool.execute(args, {
            requestContext: mockRequestContext,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
}
