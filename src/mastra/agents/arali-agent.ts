import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import type { AraliRuntimeContext } from "../context/types.js";
import type { Tool } from "@mastra/core/tools";

function getModel() {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const model = process.env.AI_MODEL;

  switch (provider) {
    case "google":
      return google(model ?? "gemini-2.5-flash");
    case "openai":
      return openai(model ?? "gpt-4o");
    case "anthropic":
    default:
      return anthropic(model ?? "claude-sonnet-4-20250514");
  }
}

// --- Read tools ---
import * as readTools from "../tools/read/index.js";
// --- Write tools ---
import * as writeTools from "../tools/write/index.js";

function buildSystemPrompt(
  userName: string,
  role: AraliRuntimeContext["userRole"],
): string {
  const scopeDescription = {
    admin:
      "You have full access to all data across the entire organization.",
    manager:
      "You can see data for all companies and team members within your org unit(s) and their sub-units.",
    rep:
      "You can see data only for companies and items assigned to you.",
  }[role];

  const writeAbility =
    role === "rep"
      ? "You do NOT have permission to create or modify records. If the user asks you to create or change something, let them know they need a manager or admin role."
      : "You can create and modify records (action items, signals, company stages, key roles, notes). Always confirm with the user before making any changes — describe exactly what will be created or changed and ask for explicit approval.";

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  });

  return `You are Arali, an AI assistant for ${userName} (${role}).

## Current Date & Time
Today is ${dateStr}, ${timeStr}.

## Your Role
You help ${userName} understand their customer portfolio, track action items, analyze meeting insights, and stay on top of signals and risks.

## Data Access
${scopeDescription}

## Capabilities
${writeAbility}

## Defaults
- "recent" means the last 30 days unless the user specifies otherwise
- "at-risk" means health score below 5 (on a 0–10 scale)
- "critical" or "red" means health score below 4
- When the user says "my companies" or "my accounts", filter to companies assigned to them
- When the user refers to a person by first name (e.g. "assign to Himanshu"), use the get-team-members tool to find their email before creating/updating records
- When creating action items, if the user doesn't specify a pipeline, use the default pipeline

## Formatting Rules
- Never show raw UUIDs — always use display names
- Use markdown tables when comparing 3 or more items
- Lead with the key answer, then provide supporting detail
- Keep responses concise — no unnecessary preamble
- Suggest relevant next steps when appropriate (e.g., "Would you like to see the full interaction timeline?")

## Tool Usage
- Use get-company-overview for questions about a single company
- Use get-companies for lists, comparisons, or filtered queries across companies
- Use get-action-items for task/to-do related queries
- Use get-insights for feature requests, objections, competitor mentions
- Use get-open-signals for risk/opportunity signals
- Use search-transcripts-keyword for finding specific mentions in call transcripts
- Use search-transcripts-semantic for conceptual/thematic transcript search
- Use get-interaction-timeline for chronological activity with a company
- Use get-billing-overview for subscription and billing questions
- Use get-tickets for support ticket queries
- Use get-portfolio-health-trend for health score trends over time
- Use search-thread-messages for searching emails, Slack messages, WhatsApp
- Use get-contacts for contact/people queries`;
}

function getToolsForRole(
  role: AraliRuntimeContext["userRole"],
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {};

  for (const [key, tool] of Object.entries(readTools)) {
    if (tool && typeof tool === "object" && "id" in tool) {
      tools[key] = tool as Tool<any, any>;
    }
  }

  if (role === "admin" || role === "manager") {
    for (const [key, tool] of Object.entries(writeTools)) {
      if (tool && typeof tool === "object" && "id" in tool) {
        tools[key] = tool as Tool<any, any>;
      }
    }
  }

  return tools;
}

export const araliAgent = new Agent({
  id: "arali-assistant",
  name: "arali-assistant",

  model: getModel(),

  memory: new Memory({
    storage: new PostgresStore({
      id: "arali-memory",
      connectionString: process.env.DATABASE_URL!,
      schemaName: "mastra",
    }),
    options: {
      lastMessages: 30,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
  }),

  instructions: ({ requestContext }) => {
    const role = requestContext.get("userRole") as AraliRuntimeContext["userRole"];
    const userName = requestContext.get("userName") as string;
    return buildSystemPrompt(userName || "User", role || "rep");
  },

  tools: ({ requestContext }) => {
    const role = requestContext.get("userRole") as AraliRuntimeContext["userRole"];
    return getToolsForRole(role || "rep");
  },
});
