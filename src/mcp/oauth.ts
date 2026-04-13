/**
 * OAuth handler functions for MCP authentication.
 * These are registered via registerApiRoute in mastra/index.ts.
 */
import type { Context } from "hono";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.MCP_BASE_URL ?? "http://localhost:4111";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** GET /.well-known/oauth-authorization-server */
export async function handleOAuthMetadata(c: Context) {
  return c.json({
    issuer: BASE_URL,
    authorization_endpoint: `${APP_URL}/mcp-login`,
    token_endpoint: `${APP_URL}/api/v1/auth/mcp-token-exchange`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  });
}

/** POST /oauth/register */
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
