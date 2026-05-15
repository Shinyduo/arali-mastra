import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MastraServer } from "@mastra/hono";
import { mastra } from "./mastra/index.js";

const app = new Hono();
const server = new MastraServer({ app, mastra });

await server.registerRoutes();

app.get("/", (c) => c.json({ status: "ok", service: "arali-mastra" }));
app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT) || 4111;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Arali Mastra server running on port ${info.port}`);
});

