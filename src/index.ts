import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MastraServer } from "@mastra/hono";
import { mastra } from "./mastra/index.js";
import { clusteringRoutes } from "./clustering/routes.js";

const app = new Hono();

// Mount clustering routes (no auth — called by pgboss)
app.route("/", clusteringRoutes);

const server = new MastraServer({ app, mastra });

await server.registerRoutes();

app.get("/", (c) => c.json({ status: "ok", service: "arali-mastra" }));
app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT) || 4111;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Arali Mastra server running on port ${info.port}`);
});
