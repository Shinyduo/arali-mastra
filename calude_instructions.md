# Arali AI Service — Claude Code Build Prompt

## What This Is

A separate microservice repo that powers the AI chat agent inside Arali (a B2B conversation intelligence / customer success platform like Gong + Avoma + CRM). The service uses Mastra AI (TypeScript agent framework built on Vercel AI SDK) with Claude as the LLM, connecting directly to the shared Arali Postgres database.

## Tech Stack

- **Framework:** Mastra AI (`@mastra/core`, `@mastra/memory`, `@mastra/pg`)
- **LLM:** Anthropic Claude Sonnet via `@ai-sdk/anthropic`
- **Embeddings:** OpenAI `text-embedding-3-small` via `@ai-sdk/openai` (for future semantic search)
- **Database:** Shared Postgres (same DB as main Arali backend)
- **ORM:** Drizzle ORM (`drizzle-orm` + `postgres` driver)
- **Validation:** Zod (Mastra uses it natively for tool schemas)
- **Language:** TypeScript, ESM modules

## Project Structure

```
arali-ai-service/
├── src/
│   ├── db/
│   │   ├── index.ts              # Drizzle DB connection (postgres-js driver)
│   │   └── schema.ts             # Full Arali Drizzle schema (copy from main repo)
│   ├── mastra/
│   │   ├── agents/
│   │   │   └── arali-agent.ts    # Main agent definition
│   │   ├── tools/
│   │   │   ├── read/
│   │   │   │   ├── get-companies.ts
│   │   │   │   ├── get-company-overview.ts
│   │   │   │   ├── get-contacts.ts
│   │   │   │   ├── get-action-items.ts
│   │   │   │   ├── get-insights.ts
│   │   │   │   ├── get-open-signals.ts
│   │   │   │   ├── get-interaction-timeline.ts
│   │   │   │   ├── get-billing-overview.ts
│   │   │   │   ├── get-tickets.ts
│   │   │   │   ├── get-portfolio-health-trend.ts
│   │   │   │   ├── search-transcripts-keyword.ts
│   │   │   │   ├── search-transcripts-semantic.ts
│   │   │   │   ├── search-thread-messages.ts
│   │   │   │   └── index.ts      # Re-exports all read tools
│   │   │   ├── write/
│   │   │   │   ├── create-action-item.ts
│   │   │   │   ├── update-action-item-stage.ts
│   │   │   │   ├── create-signal.ts
│   │   │   │   ├── dismiss-signal.ts
│   │   │   │   ├── update-company-stage.ts
│   │   │   │   ├── assign-key-role.ts
│   │   │   │   ├── create-entity-note.ts
│   │   │   │   └── index.ts      # Re-exports all write tools
│   │   │   └── index.ts          # Merges read + write exports
│   │   ├── context/
│   │   │   └── types.ts          # AraliRuntimeContext type definition
│   │   └── index.ts              # Mastra instance (agents, server config, middleware)
│   └── index.ts                  # Entry point (if running standalone)
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Architecture Decisions

### Database Access
- Tools query the shared Arali Postgres directly via Drizzle ORM — NO HTTP calls to the main backend API
- The schema file (`src/db/schema.ts`) is a copy-paste of the main repo's Drizzle schema (same pattern used for the pgboss service)
- Single DATABASE_URL pointing to the shared Arali database

### Authentication
- Browser sends JWT directly to this service (Option A — direct auth, not proxied)
- Mastra server middleware validates JWT, extracts user identity
- RuntimeContext is populated from JWT payload: `enterpriseId`, `userId`, `userName`, `userEmail`, `orgUnitId`, `userRole`
- Every tool reads `enterpriseId` from RuntimeContext — the LLM CANNOT override tenant context

### RBAC (Three Layers)
1. **Tool visibility:** Dynamic `tools` function on Agent filters available tools by user role (`rep` gets read-only, `manager` gets read+write, `admin` gets everything)
2. **Data filtering:** Every tool enforces row-level access — `rep` sees only their owned companies, `manager` sees their org unit, `admin` sees all
3. **System prompt:** Dynamic instructions tell the LLM the user's scope (UX guide, not security boundary)

### Memory
- Uses `@mastra/memory` with `@mastra/pg` storage (same Postgres, Mastra auto-creates its own prefixed tables)
- V1: Only conversation history (`lastMessages: 30`), no semantic recall, no working memory
- Threads are identified by `threadId` (from frontend), grouped by `resourceId` (userId)

### HITL (Human-in-the-Loop)
- All read tools auto-execute (no confirmation needed)
- All write tools require user confirmation before execution
- Mastra's suspend/resume handles this — when a write tool is called, execution pauses, frontend shows confirmation card, user approves/rejects, execution resumes or cancels

### Model Choice
- Default: `anthropic/claude-sonnet-4-20250514` for all users
- Do NOT use Opus — Sonnet is sufficient for tool-calling agents and is faster/cheaper

## RuntimeContext Type

```typescript
export type AraliRuntimeContext = {
  enterpriseId: string;
  userId: string;
  userName: string;
  userEmail: string;
  orgUnitId: string | null;
  userRole: "admin" | "manager" | "rep";
};
```

## Tool Design Pattern

Every tool follows this exact pattern:

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../db";
import { companies, appUser } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { AraliRuntimeContext } from "../context/types";

export const getCompanies = createTool({
  id: "get-companies",
  description: "...", // Clear description for LLM to decide when to use
  inputSchema: z.object({
    // Only params the LLM controls — NEVER enterpriseId
  }),
  execute: async ({ context, runtimeContext }) => {
    const enterpriseId = runtimeContext.get("enterpriseId") as AraliRuntimeContext["enterpriseId"];
    const userId = runtimeContext.get("userId") as AraliRuntimeContext["userId"];
    const role = runtimeContext.get("userRole") as AraliRuntimeContext["userRole"];

    // 1. Always filter by enterpriseId
    // 2. Apply RBAC based on role
    // 3. Return structured data (never raw SQL, never UUIDs in display)
  },
});
```

## Agent Definition

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PgStore } from "@mastra/pg";
import type { AraliRuntimeContext } from "../context/types";

export const araliAgent = new Agent({
  name: "arali-assistant",

  model: "anthropic/claude-sonnet-4-20250514",

  memory: new Memory({
    storage: new PgStore({ connectionString: process.env.DATABASE_URL! }),
    options: {
      lastMessages: 30,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
  }),

  // Dynamic instructions based on user role
  instructions: async ({ runtimeContext }) => {
    const role = runtimeContext.get("userRole");
    const userName = runtimeContext.get("userName");
    // Build system prompt based on role...
  },

  // Dynamic tools based on user role (RBAC layer 1)
  tools: ({ runtimeContext }) => {
    const role = runtimeContext.get("userRole");
    // Return filtered tool set based on role...
  },
});
```

## Mastra Server Config (index.ts)

```typescript
import { Mastra } from "@mastra/core/mastra";
import { PgStore } from "@mastra/pg";
import { araliAgent } from "./agents/arali-agent";

export const mastra = new Mastra({
  agents: { araliAgent },
  storage: new PgStore({ connectionString: process.env.DATABASE_URL! }),
  server: {
    port: Number(process.env.PORT) || 4111,
    middleware: [
      // JWT validation middleware
      // Populates RuntimeContext with enterpriseId, userId, role, etc.
    ],
  },
});
```

## System Prompt Guidelines

The dynamic system prompt should:
- Identify the user by name and role
- List what the user can/cannot do based on role
- Define defaults: "recent" = 30 days, "at-risk" = health < 5, "critical/red" = health < 4
- Tell the agent to never show raw UUIDs, always use display names
- Tell the agent to suggest next steps when relevant
- Tell the agent to use tables for comparisons
- Tell the agent to lead with the key answer, not preamble
- For write actions: always confirm before executing, show what will be created/changed

## Read Tools to Build (Priority Order)

Build these first — they cover the most common queries:

### 1. get-companies
- **Tables:** companies, appUser (owner join), stageDefinition
- **Filters:** health_score (lt/gt/eq), stage (by stageDefinitionId or key), ARR (lt/gt), ownerUserId, domain
- **RBAC:** rep=own companies only, manager=org unit companies, admin=all
- **Sort:** health_score, arr, name, updatedAt
- **Pagination:** limit + offset
- **Use cases:** 1, 4, 5, 6, 26, 29, 78, 96

### 2. get-company-overview
- **Tables:** companies, accounts, companySignal, keyRoleAssignments, keyRoleDefinitions, appUser, entityMetricHistory, stageDefinition
- **Input:** companyName (fuzzy ILIKE match) or companyId
- **Returns:** company details + health + ARR + owner + stage + open signals count + key role assignments (CSM, AE, etc.) + recent health trend
- **RBAC:** same ownership check
- **Use cases:** 2, 15, 25, 31, 36, 37, 40, 68, 90, 97

### 3. get-action-items
- **Tables:** actionItem, pipelineStage, actionItemEntity, actionItemSubtask, companies, appUser
- **Filters:** status (via currentStageId → pipelineStage.bucket), priority, ownerUserId, dueAt (overdue = dueAt < now), companyId (via actionItemEntity)
- **RBAC:** rep=own items, manager=org unit items, admin=all
- **Use cases:** 22, 47, 87, 88, 89

### 4. get-insights
- **Tables:** meetingInsights, insightClusters, companies (via interactionCompany → interactions → meetingInsights)
- **Filters:** metricKey (feature/objection/issue/competitor_mention), companyId, date range, productId
- **Group by:** cluster (insightClusters.name), company, month/week
- **Sort:** count, recency
- **Use cases:** 7-11, 13-14, 16-17, 41-43, 49

### 5. get-open-signals
- **Tables:** companySignal, companySignalOccurrence, companies, appUser
- **Filters:** type (risk/opportunity/info), severity, status, ownerUserId, companyId, categoryKey
- **Sort:** severity, lastSeenAt
- **RBAC:** same ownership model
- **Use cases:** 68-71

### 6. search-transcripts-keyword
- **Tables:** transcript (searchVector GIN), transcriptSegments, meetings, participants, interactionCompany, companies
- **Input:** query string → tsquery, companyName filter, date range
- **Returns:** matching segments with speaker name, timestamp (startMs), meeting title, date, company
- **Use cases:** 21, 27, 53, 61

### 7. get-contacts
- **Tables:** contacts, contactEmails, contactPhones, customerCompany, companies
- **Filters:** companyId, emailSearch, nameSearch, role
- **RBAC:** scoped to companies the user can see
- **Use cases:** 33-35, 64-67

### 8. get-interaction-timeline
- **Tables:** interactions, meetings, calls, threads, tickets, interactionCompany, participants, appUser
- **Input:** companyId or companyName, date range, kind filter (meeting/call/thread/ticket)
- **Returns:** chronological list of all interactions with that company
- **Use cases:** 19, 20, 23-25

### 9. get-billing-overview
- **Tables:** billingSubscriptions, billingPlans, billingInvoice, subscriptionLineItems, billingProducts
- **Input:** companyId or companyName
- **Returns:** active subscription details, MRR, plan name, open invoices, upcoming renewal date
- **Use cases:** 74-79

### 10. get-tickets
- **Tables:** tickets, ticketMessages, ticketStatusLogs, interactions, interactionCompany, companies
- **Filters:** status, companyId, date range
- **Returns:** ticket list with status, subject, first response time, resolution time
- **Use cases:** 80-83

### 11. get-portfolio-health-trend
- **Tables:** entityMetricHistory, companies
- **Input:** date range, granularity (daily/weekly/monthly), group by (owner/stage/segment)
- **Returns:** time series of health scores across the portfolio
- **Use cases:** 3, 38, 44, 45, 50, 97, 98

### 12. search-thread-messages
- **Tables:** threadMessages (searchVector GIN), threads, interactionCompany, companies
- **Input:** query string, channel filter (email/message/whatsapp), companyName, date range
- **Returns:** matching messages with thread subject, sender, date, channel
- **Use cases:** 84-86

### 13. search-transcripts-semantic
- **Tables:** transcriptChunkEmbedding (pgvector), transcript, meetings, interactionCompany, companies
- **Input:** query string → embed → vector similarity search
- **Returns:** semantically similar transcript chunks with meeting context
- **Note:** Requires embedding the query via OpenAI text-embedding-3-small before searching
- **Use cases:** 8, 30, 48

## Write Tools to Build (All HITL-gated)

### 1. create-action-item
- **Inserts into:** actionItem + actionItemEntity (link to company/contact)
- **Resolves:** owner by email → appUser, default pipeline + first stage
- **Input:** title, description, ownerEmail, priority, dueAt, companyName

### 2. update-action-item-stage
- **Updates:** actionItem.currentStageId
- **Input:** actionItemId (or title search), targetStageName
- **Validates:** stage exists in the action item's pipeline

### 3. create-signal
- **Inserts into:** companySignal + companySignalOccurrence
- **Input:** companyName, type (risk/opportunity/info), categoryKey, title, severity
- **Generates:** dedupeKey deterministically

### 4. dismiss-signal
- **Updates:** companySignal.status → "dismissed", sets dismissedAt
- **Input:** signalId or companyName + signal title search

### 5. update-company-stage
- **Updates:** companies.stageDefinitionId
- **Input:** companyName, targetStageKey
- **Validates:** stage exists for scope=company in that enterprise

### 6. assign-key-role
- **Updates:** Ends current assignment (sets endAt), creates new keyRoleAssignment
- **Input:** companyName, roleKey (csm/ae/tam), newOwnerEmail
- **Resolves:** keyRoleDefinition by key, user by email

### 7. create-entity-note
- **Inserts into:** entityNotes
- **Input:** entityType (company/contact/account), entityName (resolved to ID), title, content

## Build Order

1. Set up repo: package.json, tsconfig, .env, DB connection, paste schema
2. Create RuntimeContext types and JWT middleware
3. Build the agent skeleton with dynamic instructions and dynamic tools
4. Build 3 read tools first: `get-companies`, `get-company-overview`, `get-action-items`
5. Test in Mastra Studio (`mastra dev`)
6. Build remaining read tools
7. Build write tools with HITL
8. Add system prompt refinements based on testing
9. Wire up to frontend via chatRoute or custom Express route

## Key Schema Relationships to Know

- `companies` → `accounts` (1:many, accounts belong to a company)
- `companies` ↔ `contacts` via `customerCompany` (M:M)
- `companies` ↔ `interactions` via `interactionCompany` (M:M)
- `interactions` → `meetings` / `calls` / `threads` / `tickets` (1:1, kind-specific detail tables)
- `meetings` → `transcript` → `transcriptSegments` (transcript text + timestamps)
- `meetings` → `participants` (who was in the meeting)
- `meetings` → `meetingInsights` → `insightClusters` (AI-extracted features/objections/issues)
- `companySignal` → `companySignalOccurrence` (deduped signal + evidence history)
- `actionItem` → `pipelineStage` (current stage in pipeline)
- `actionItem` ↔ entities via `actionItemEntity` (link to company/contact/interaction)
- `keyRoleAssignments` → `keyRoleDefinitions` → `typeDefinitions` (CSM/AE role assignments with history)
- `billingSubscriptions` → `billingPlans` → `billingPlanProducts` → `billingProducts` (subscription structure)
- `entityMetricHistory` — polymorphic metric history for any entity (health scores over time)
- `transcript.searchVector` — tsvector GIN index for full-text keyword search
- `transcriptChunkEmbedding.embedding` — vector(1536) for semantic search via pgvector
- `threadMessages.searchVector` — tsvector GIN index for email/slack/whatsapp search

## Important Schema Quirks

- `companies.ARR` is capitalized in the schema (column name is `arr` in DB but property is `ARR` in Drizzle)
- `companies.healthScore` is integer 0-10, NOT a string enum
- `keyRoleAssignments` uses `entityType = 'company'` or `'contact'` — text field, not enum
- `metricsData.valueNumber` is stored as TEXT, not numeric — cast when doing math
- `pipelineStage.bucket` has values: open, in_progress, blocked, done, archived
- `companySignal.dedupeKey` must be deterministic for upsert logic
- `contactEmails` and `contactPhones` are junction tables (not fields on contacts)
- `threadMessages.searchVector` needs to be populated by your backend — Mastra won't do this
- `interactions.kind` determines which detail table to join: meeting→meetings, call→calls, thread→threads, ticket→tickets

## Environment Variables

```
ANTHROPIC_API_KEY=           # Required — Claude model access
OPENAI_API_KEY=              # Required — for embeddings (semantic search tools)
DATABASE_URL=                # Required — shared Arali Postgres
PORT=4111                    # Optional — defaults to 4111
NODE_ENV=development         # Optional
```