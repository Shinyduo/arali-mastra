import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import type { Tool } from "@mastra/core/tools";
import type { ScopedCapabilityMap } from "../../lib/resolve-user-role.js";
import { hasWriteAccess, getCompanyScope } from "../../lib/rbac.js";

const openrouter = createOpenRouter();

function getProvider() {
  return process.env.AI_PROVIDER ?? "anthropic";
}

function getModel() {
  const provider = getProvider();
  const model = process.env.AI_MODEL;

  switch (provider) {
    case "google":
      return google(model ?? "gemini-3-flash-preview");
    case "openai":
      return openai(model ?? "gpt-4o");
    case "openrouter":
      return openrouter(model ?? "openrouter/auto");
    case "kimi":
      return openrouter(model ?? "moonshotai/kimi-k2.5");
    case "minimax":
      return openrouter(model ?? "minimax/minimax-m2.1");
    case "anthropic":
    default:
      return anthropic(model ?? "claude-sonnet-4-20250514");
  }
}

// --- Read tools ---
import * as readTools from "../tools/read/index.js";
// --- Write tools ---
import * as writeTools from "../tools/write/index.js";

function describeScope(capabilities: ScopedCapabilityMap): string {
  const scope = getCompanyScope(capabilities);
  if (!scope) {
    return "You have no access to company data. You can only answer general questions.";
  }
  if (scope.enterprise) {
    return "You have full access to all data across the entire organization.";
  }
  const parts: string[] = [];
  if (scope.orgUnits.length > 0) {
    parts.push("data within your org unit(s) and their sub-units");
  }
  if (scope.self) {
    parts.push("companies and entities directly assigned to you");
  }
  if (parts.length === 0) {
    return "You have limited access. Some queries may return empty results.";
  }
  return `You can see ${parts.join(", and ")}.`;
}

function buildSystemPrompt(
  userName: string,
  capabilities: ScopedCapabilityMap,
): string {
  const scopeDescription = describeScope(capabilities);
  const canWrite = hasWriteAccess(capabilities);

  const writeAbility = canWrite
    ? "You can create and modify records (action items, signals, company stages, key roles, notes). Always confirm with the user before making any changes — describe exactly what will be created or changed and ask for explicit approval."
    : "You do NOT have permission to create or modify records. If the user asks you to create or change something, let them know they need the appropriate permissions.";

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

  return `You are Arali Agent, an AI assistant for ${userName}.

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

## Response Size
- For simple listing queries ("show me red accounts", "what signals are open?"), use limit=4 and offer to show more
- Only use higher limits when the user explicitly asks ("show me all", "give me the full list", "show me 10")
- After a short list, add a brief prompt like "Want to see more?" or "Showing top 4 — ask for more if needed"

## Formatting Rules
- Never show raw UUIDs — always use display names
- Use markdown tables when comparing 3 or more items
- Lead with the key answer, then provide supporting detail
- Keep responses concise — no unnecessary preamble
- Suggest relevant next steps when appropriate (e.g., "Would you like to see the full interaction timeline?")
- When presenting data that benefits from visual charts (distributions, comparisons, proportions, flows), use Mermaid diagrams inside fenced code blocks (e.g. \`\`\`mermaid). Supported types: pie, bar (xychart-beta), flowchart, timeline. Prefer pie charts for proportions, bar charts for comparisons, and flowcharts for processes

## Planning
Before making tool calls, briefly plan your approach:
1. Identify which tools you need and in what order
2. Prefer composite tools (brief-me, my-day-today, weekly-digest) over multiple individual calls — they fetch everything in one step
3. Call independent tools in parallel when possible (e.g., get-open-signals + get-action-items together)
4. Avoid redundant calls — if get-company-overview already returned signals, don't call get-open-signals again for the same company
5. You have a maximum of 10 tool calls per response — plan accordingly and prioritize the most valuable data first

## Tool Usage
- Use get-company-overview for questions about a single company
- Use get-companies for lists, comparisons, or filtered queries across companies. Supports: health trend filter (declining/improving/stable), no-owner filter, days since last interaction, creation date range, daysSinceStageChange (use with stageKey to find companies stuck at a stage for N+ days)
- Use get-action-items for task/to-do related queries. Supports: unassigned filter, due date range, creation date range, sort by dueAt/createdAt/priority
- Use get-insights for feature requests, objections, competitor mentions
- Use get-open-signals for listing risk/opportunity signals. Supports: unassigned filter, overdue filter, first-seen date range
- Use get-contacts for contact/people/lead queries. Supports: creation date range for "new leads today" type queries
- Use get-signal-details when the user asks WHY a signal exists, or wants to dig into the evidence — it returns occurrences, linked interactions, and transcript text. Always use this when the user says "look into the interaction" or "why is this signal showing"
- Use search-transcripts-keyword for finding specific mentions in call transcripts
- Use search-transcripts-semantic for conceptual/thematic transcript search
- Use get-interaction-timeline for chronological activity with a company
- Use get-billing-overview for subscription and billing questions
- Use get-tickets for support ticket queries
- Use get-portfolio-health-trend for health score trends over time
- Use search-thread-messages for searching emails, Slack messages, WhatsApp
- Use get-metrics for NPS, CSAT, BANT scores, meeting summaries, talk ratios, and any other tracked metrics. Call without metricKey first to discover available metrics.
- Use get-team-members to resolve a person's first name to their email
- Use brief-me for pre-call prep: "brief me on Acme" returns overview + signals + action items + recent interactions + last meeting insights in one shot
- Use my-day-today for "what's on my plate today?" — today's meetings, overdue items, new signals
- Use weekly-digest for "weekly summary" — signals, health changes, overdue items, meetings, untouched accounts. Pass onlyMine=true when user says "my week", "my summary", or refers to themselves personally; omit it for generic "this week" / "team" queries

## Tool Limitations & Partial Results
- If a requested filter or parameter does not exist in a tool, use the closest available filter, return the results, and clearly explain the limitation in your response (e.g. "I filtered by stage but couldn't filter by exact duration — here are all companies in that stage:")
- Never retry the same tool call repeatedly if the results don't perfectly match the request — answer with what you found and note what you couldn't filter
- If results are empty, say so clearly and suggest alternatives (e.g. different stage name, broader time range)

## Multi-Tool Orchestration
When answering complex questions, combine multiple tools:
- "Why is Acme's health dropping?" → get-company-overview (health score + trend) → get-open-signals (risks for Acme) → get-signal-details (evidence for the top signal) → get-interaction-timeline (recent activity to check engagement gaps)
- "Prepare me for my call with Acme" → brief-me (overview + signals + action items + recent interactions + metrics in one shot)
- "Create an action item for Himanshu on Acme" → get-team-members (resolve "Himanshu" to email) → create-action-item (use resolved email as owner)
- "Which of my at-risk accounts haven't been contacted recently?" → get-companies (healthScoreMax=4, ownerEmail=user's email, daysSinceLastInteraction=14)
- "What did John discuss about pricing this week?" → get-team-members (resolve "John" to email) → search-transcripts-keyword (query="pricing", email filter) or search-transcripts-semantic (conceptual search)
- "Show me all unactioned signals and overdue tasks" → get-open-signals (unassigned=true) + get-action-items (overdue=true) — call both in parallel, then combine the results
- "What's the CSAT trend for Acme?" → get-metrics (companyName="Acme", metricKey="csat") → get-portfolio-health-trend (for visual trend context)`;
}

function getToolsForCapabilities(
  capabilities: ScopedCapabilityMap,
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {};

  // Read tools — always available (RBAC is enforced inside each tool)
  for (const [key, tool] of Object.entries(readTools)) {
    if (tool && typeof tool === "object" && "id" in tool) {
      tools[key] = tool as Tool<any, any>;
    }
  }

  // Write tools — only if user has write access
  if (hasWriteAccess(capabilities)) {
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
      lastMessages: 15,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
  }),

  instructions: ({ requestContext }) => {
    const capabilities = (requestContext.get("capabilities") as ScopedCapabilityMap) ?? {};
    const userName = requestContext.get("userName") as string;
    const content = buildSystemPrompt(userName || "User", capabilities);

    // Enable prompt caching for Anthropic — the system prompt is large and
    // stable per user, so caching saves input token costs on follow-up turns.
    if (getProvider() === "anthropic") {
      return {
        role: "system" as const,
        content,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      };
    }

    return content;
  },

  tools: ({ requestContext }) => {
    const capabilities = (requestContext.get("capabilities") as ScopedCapabilityMap) ?? {};
    return getToolsForCapabilities(capabilities);
  },
});
