/**
 * OAuth handler functions for MCP authentication.
 *
 * MCP spec (2025-06-18): MCP server is a Resource Server, NOT an Authorization Server.
 * - MCP server exposes /.well-known/oauth-protected-resource (RFC 9728)
 * - Authorization Server (arali-main) exposes /.well-known/oauth-authorization-server (RFC 8414)
 * - /oauth/register lives on arali-mastra (same origin as /mcp)
 */
import type { Context } from "hono";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.MCP_BASE_URL ?? "http://localhost:4111";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** GET /.well-known/oauth-protected-resource — Resource Server metadata (RFC 9728) */
export async function handleProtectedResourceMetadata(c: Context) {
  return c.json({
    resource: BASE_URL,
    authorization_servers: [APP_URL],
    bearer_methods_supported: ["header"],
  });
}

/** POST /oauth/register — Dynamic Client Registration (no-op) */
export async function handleOAuthRegister(c: Context) {
  const body = await c.req.json().catch(() => ({}));
  const { client_name = "unknown", redirect_uris = [] } = body as {
    client_name?: string;
    redirect_uris?: string[];
  };

  return c.json({
    client_id: randomUUID(),
    client_secret: randomUUID(),
    client_name,
    redirect_uris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, 201);
}
