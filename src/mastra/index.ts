import "dotenv/config";
import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { registerApiRoute } from "@mastra/core/server";
import { createMiddleware } from "hono/factory";
import { verifyJwt } from "../lib/jwt.js";
import { getUserCapabilities, getUserOrgUnitIds } from "../lib/resolve-user-role.js";
import type { RequestContext } from "@mastra/core/request-context";
import { araliAgent } from "./agents/arali-agent.js";
import {
  OnlineTaskRequestSchema,
  DailyTaskRequestSchema,
  WeeklyTaskRequestSchema,
  BootstrapRequestSchema,
  TrendsQuerySchema,
} from "../clustering/types.js";
import { runOnline, runDaily, runWeeklyMaintenance } from "../clustering/tasks.js";
import { bootstrap } from "../clustering/service.js";
import { getEmergingTrends } from "../clustering/trends.js";
import { handleProtectedResourceMetadata, handleAuthServerMetadata, handleOAuthRegister, handleMcp } from "../mcp/index.js";

// Paths that skip JWT auth (studio UI, health checks, static assets)
const PUBLIC_PATHS = ["/studio", "/health", "/assets", "/mastra.svg", "/clustering", "/mcp", "/oauth", "/.well-known"];

const authMiddleware = createMiddleware(async (c, next) => {
  const path = c.req.path;

  // Skip auth for public paths
  if (path === "/" || PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return next();
  }

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

    const userId = claims.sub as string;

    const [capabilities, orgUnitIds] = await Promise.all([
      getUserCapabilities(userId, enterpriseId),
      getUserOrgUnitIds(userId, enterpriseId),
    ]);

    const requestContext = c.get("requestContext") as RequestContext;
    requestContext.set("enterpriseId", enterpriseId);
    requestContext.set("userId", userId);
    requestContext.set("userName", (claims.name || claims.email) as string);
    requestContext.set("userEmail", claims.email as string);
    requestContext.set("orgUnitIds", orgUnitIds);
    requestContext.set("capabilities", capabilities);
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  await next();
});

export const mastra = new Mastra({
  agents: { araliAgent },
  storage: new PostgresStore({
    id: "arali-mastra",
    connectionString: process.env.DATABASE_URL!,
    schemaName: "mastra",
  }),
  server: {
    port: Number(process.env.PORT) || 4111,
    middleware: [authMiddleware],
    apiRoutes: [
      registerApiRoute("/clustering/online", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          try {
            const body = await c.req.json();
            const { insight_id } = OnlineTaskRequestSchema.parse(body);
            const clusterId = await runOnline(insight_id);
            return c.json({ cluster_id: clusterId });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("not found")) return c.json({ error: message }, 404);
            console.error("[clustering] Online error:", err);
            return c.json({ error: message }, 500);
          }
        },
      }),
      registerApiRoute("/clustering/daily", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          try {
            const body = await c.req.json();
            const { batch_size } = DailyTaskRequestSchema.parse(body);
            runDaily(batch_size).catch((err) => console.error("[clustering] Daily task error:", err));
            return c.json({ status: "accepted", message: `Daily task started with batch_size=${batch_size}` });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[clustering] Daily error:", err);
            return c.json({ error: message }, 500);
          }
        },
      }),
      registerApiRoute("/clustering/weekly/maintenance", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          try {
            const body = await c.req.json().catch(() => ({}));
            const parsed = WeeklyTaskRequestSchema.parse(body);
            runWeeklyMaintenance(parsed.enterprise_id ?? undefined).catch((err) =>
              console.error("[clustering] Weekly maintenance error:", err),
            );
            return c.json({ status: "accepted", message: "Weekly maintenance started" });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[clustering] Weekly error:", err);
            return c.json({ error: message }, 500);
          }
        },
      }),
      registerApiRoute("/clustering/bootstrap", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          try {
            const query = c.req.query();
            const { enterprise_id, metric_key } = BootstrapRequestSchema.parse(query);
            bootstrap(enterprise_id, metric_key).catch((err) =>
              console.error("[clustering] Bootstrap error:", err),
            );
            return c.json({ status: "accepted", message: `Bootstrap started for ${enterprise_id} (${metric_key})` });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[clustering] Bootstrap error:", err);
            return c.json({ error: message }, 500);
          }
        },
      }),
      registerApiRoute("/clustering/trends", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          try {
            const query = c.req.query();
            const { enterprise_id, metric_key, days } = TrendsQuerySchema.parse(query);
            const result = await getEmergingTrends(enterprise_id, metric_key, days);
            return c.json(result);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[clustering] Trends error:", err);
            return c.json({ error: message }, 500);
          }
        },
      }),

      // --- MCP OAuth + Server ---
      registerApiRoute("/.well-known/oauth-protected-resource", {
        method: "GET",
        requiresAuth: false,
        handler: handleProtectedResourceMetadata,
      }),
      registerApiRoute("/.well-known/oauth-authorization-server", {
        method: "GET",
        requiresAuth: false,
        handler: handleAuthServerMetadata,
      }),
      registerApiRoute("/oauth/register", {
        method: "POST",
        requiresAuth: false,
        handler: handleOAuthRegister,
      }),
      registerApiRoute("/mcp", {
        method: "ALL",
        requiresAuth: false,
        handler: handleMcp,
      }),
    ],
  },
});
