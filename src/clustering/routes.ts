/**
 * Hono route handlers for clustering endpoints.
 * Matches the arali-python FastAPI API exactly.
 */

import { Hono } from "hono";
import {
  OnlineTaskRequestSchema,
  DailyTaskRequestSchema,
  WeeklyTaskRequestSchema,
  BootstrapRequestSchema,
  TrendsQuerySchema,
} from "./types.js";
import { runOnline, runDaily, runWeeklyMaintenance } from "./tasks.js";
import { bootstrap } from "./service.js";
import { getEmergingTrends } from "./trends.js";

export const clusteringRoutes = new Hono();

// POST /clustering/online — synchronous, returns cluster_id
clusteringRoutes.post("/clustering/online", async (c) => {
  try {
    const body = await c.req.json();
    const { insight_id } = OnlineTaskRequestSchema.parse(body);
    const clusterId = await runOnline(insight_id);
    return c.json({ cluster_id: clusterId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return c.json({ error: message }, 404);
    }
    console.error("[clustering] Online error:", err);
    return c.json({ error: message }, 500);
  }
});

// POST /clustering/daily — returns 200 immediately, runs in background
clusteringRoutes.post("/clustering/daily", async (c) => {
  try {
    const body = await c.req.json();
    const { batch_size } = DailyTaskRequestSchema.parse(body);

    // Fire-and-forget (matches Python BackgroundTasks behavior)
    runDaily(batch_size).catch((err) =>
      console.error("[clustering] Daily task error:", err),
    );

    return c.json({
      status: "accepted",
      message: `Daily task started with batch_size=${batch_size}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clustering] Daily error:", err);
    return c.json({ error: message }, 500);
  }
});

// POST /clustering/weekly/maintenance — returns 200 immediately, runs in background
clusteringRoutes.post("/clustering/weekly/maintenance", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = WeeklyTaskRequestSchema.parse(body);

    runWeeklyMaintenance(parsed.enterprise_id ?? undefined).catch((err) =>
      console.error("[clustering] Weekly maintenance error:", err),
    );

    return c.json({
      status: "accepted",
      message: "Weekly maintenance started",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clustering] Weekly error:", err);
    return c.json({ error: message }, 500);
  }
});

// POST /clustering/bootstrap — returns 200 immediately, runs in background
clusteringRoutes.post("/clustering/bootstrap", async (c) => {
  try {
    const query = c.req.query();
    const { enterprise_id, metric_key } = BootstrapRequestSchema.parse(query);

    bootstrap(enterprise_id, metric_key).catch((err) =>
      console.error("[clustering] Bootstrap error:", err),
    );

    return c.json({
      status: "accepted",
      message: `Bootstrap started for ${enterprise_id} (${metric_key})`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clustering] Bootstrap error:", err);
    return c.json({ error: message }, 500);
  }
});

// GET /clustering/trends — synchronous
clusteringRoutes.get("/clustering/trends", async (c) => {
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
});
