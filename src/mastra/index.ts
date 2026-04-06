import "dotenv/config";
import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { createMiddleware } from "hono/factory";
import { verifyJwt } from "../lib/jwt.js";
import { resolveUserRole } from "../lib/resolve-user-role.js";
import type { RequestContext } from "@mastra/core/request-context";
import { araliAgent } from "./agents/arali-agent.js";

const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const claims = await verifyJwt(token);

    const enterpriseId = (claims.selectedEnterpriseId || claims.enterpriseId) as
      | string
      | undefined;
    if (!enterpriseId) {
      return c.json({ error: "No enterprise context in token" }, 401);
    }

    const { role, orgUnitIds } = await resolveUserRole(
      claims.sub as string,
      enterpriseId,
    );

    const requestContext = c.get("requestContext") as RequestContext;
    requestContext.set("enterpriseId", enterpriseId);
    requestContext.set("userId", claims.sub as string);
    requestContext.set("userName", (claims.name || claims.email) as string);
    requestContext.set("userEmail", claims.email as string);
    requestContext.set("orgUnitIds", orgUnitIds);
    requestContext.set("userRole", role);
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  await next();
});

export const mastra = new Mastra({
  agents: { araliAgent },
  storage: new PostgresStore({ connectionString: process.env.DATABASE_URL! }),
  server: {
    port: Number(process.env.PORT) || 4111,
    middleware: [authMiddleware],
  },
});
