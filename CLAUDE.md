# CLAUDE.md — arali-mastra

## Overview

Mastra AI chat agent microservice for the Arali platform. Provides a natural-language interface to CRM data — companies, contacts, meetings, transcripts, signals, metrics, billing, and more. Uses **Mastra AI** framework with Claude Sonnet (default), Gemini, or OpenAI as the LLM.

Connects directly to the shared Arali PostgreSQL database (same as arali-main). Enforces multi-tenant isolation (`enterprise_id`) and capability-based RBAC at every tool level.

## Commands

```bash
npm run dev        # Mastra dev server + Studio UI (port 4111)
npm run build      # Production build with Studio (mastra build --studio)
npm start          # Run production build (node .mastra/output/index.mjs)
npm run typecheck  # Type-check without emitting
```

## Architecture

```
src/
├── index.ts                      # Production entry (Hono server)
├── db/
│   ├── index.ts                  # Drizzle + postgres-js connection
│   └── schema.ts                 # Copy of arali-main's Drizzle schema
├── lib/
│   ├── jwt.ts                    # JWT verification (jose, HS256, shared JWT_SECRET)
│   ├── resolve-user-role.ts      # Loads ScopedCapabilityMap from DB
│   └── rbac.ts                   # SQL builders for RBAC scope filters
├── mastra/
│   ├── index.ts                  # Mastra instance + JWT auth middleware
│   ├── context/types.ts          # AraliRuntimeContext type
│   ├── agents/arali-agent.ts     # Agent definition (dynamic prompt + tools)
│   └── tools/
│       ├── read/                 # 19 read tools (always available)
│       └── write/                # 8 write tools (gated by hasWriteAccess)
```

### Request Flow

1. Request hits Hono server with `Authorization: Bearer <JWT>`
2. Auth middleware verifies JWT, extracts `userId` + `enterpriseId`
3. Fetches `ScopedCapabilityMap` + `orgUnitIds` from DB in parallel
4. Sets all values on Mastra's `RequestContext`
5. Agent builds dynamic system prompt and tool set from capabilities
6. Each tool extracts context, applies `enterpriseId` filter + RBAC scope

### RBAC Model

Mirrors arali-main's capability-based system. Permissions are resolved from `user_role_assignment -> role_permission -> permission` with three scope levels:

- **Enterprise**: full access, no additional filter
- **Org-unit**: access via `key_role_assignments` + `user_org_unit` + `org_unit_closure` hierarchy
- **Self**: only entities directly assigned to the user via `key_role_assignments`

Key RBAC functions in `src/lib/rbac.ts`:
- `buildKeyRoleScopeClause()` — companies/accounts scope via `key_role_assignments`
- `buildContactScopeClause()` — contacts with different `end_at` logic
- `buildOwnerScopeFilter()` — action items by `ownerUserId`
- `getCompanyScope()` — convenience for `meeting.read` capability
- `hasWriteAccess()` — checks `meeting.create` capability

### Ownership Model

- **Companies, contacts, accounts**: ownership is determined via `key_role_assignments` table, NOT `ownerUserId`
- **Action items**: ownership is via `ownerUserId` directly on the `action_item` table
- **Signals**: belong to a company; ownership filters use key roles on the parent company

### Date Handling

All `endDate`/`createdBefore`/`firstSeenBefore` filters use `::date + INTERVAL '1 day'` pattern (not `::timestamptz`) so same-day queries work correctly (e.g., `createdAfter=2026-04-03 AND createdBefore=2026-04-03` includes the full day).

### Overdue Logic

Action items use `COALESCE(overdue_at, due_at)` for all overdue calculations — the `overdue_at` column takes priority when set, falling back to `due_at`.

## Tools

### Read Tools (19)

| Tool | Purpose |
|------|---------|
| `get-companies` | List/filter companies (health, stage, ARR, owner via key roles, creation date, inactivity, health trend, custom fields) |
| `get-company-overview` | Single company deep dive (health, key roles, signals, accounts, custom fields, health trend) |
| `get-action-items` | Tasks/to-dos (status, priority, overdue, unassigned, due/created date range, sort by dueAt/createdAt/priority) |
| `get-contacts` | Contacts/leads (name, email, title, company, creation date range) |
| `get-open-signals` | Company signals (type, severity, category, overdue, unassigned via key roles, first-seen date range) |
| `get-signal-details` | Signal deep dive with occurrences, linked interactions, transcript evidence |
| `get-insights` | Meeting insights grouped by cluster (feature requests, objections, competitors) |
| `get-interaction-timeline` | Chronological interactions across all accessible companies (with participants) |
| `get-metrics` | Metric scores (NPS, CSAT, BANT, meeting summaries) with hierarchical override (org_unit > enterprise > global) |
| `get-portfolio-health-trend` | Health score trends over time (daily/weekly/monthly, group by owner/stage) |
| `get-billing-overview` | Subscriptions, plans, MRR, open invoices |
| `get-tickets` | Support tickets with resolution times |
| `get-contacts` | Contact/lead queries with creation date filtering |
| `get-team-members` | Resolve first names to emails |
| `search-transcripts-keyword` | Full-text search on call transcripts (tsvector) |
| `search-transcripts-semantic` | Semantic/conceptual transcript search (pgvector embeddings) |
| `search-thread-messages` | Search emails, Slack, WhatsApp messages |
| `brief-me` | Composite: company overview + signals + action items + interactions + metrics in one call |
| `my-day-today` | Composite: today's meetings + overdue items + new signals |
| `weekly-digest` | Composite: weekly signals + health changes + overdue items + meetings |

### Write Tools (8)

Gated by `hasWriteAccess()`. Use `confirmed` boolean flag pattern (not suspend/resume) for HITL confirmation.

| Tool | Purpose |
|------|---------|
| `create-action-item` | Create task with owner, pipeline, priority |
| `update-action-item-stage` | Move task to a different pipeline stage |
| `create-signal` | Create company signal with dedupe |
| `dismiss-signal` | Dismiss a signal |
| `update-company-stage` | Change company lifecycle stage |
| `assign-key-role` | Assign user to company key role (ends previous assignment) |
| `create-entity-note` | Add note to company/contact/account |
| `update-company-fields` | Update company custom field values |

## Tool Development Patterns

Every tool follows the same pattern:

```typescript
createTool({
  id: "tool-name",
  inputSchema: z.object({ /* never include enterpriseId */ }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(context.requestContext!);
    // 1. Always filter by enterpriseId
    // 2. Apply RBAC via rbac.ts helpers
    // 3. Company/contact/account ownership = key_role_assignments
    // 4. Action item ownership = ownerUserId
    // 5. Date "before" filters use ::date + INTERVAL '1 day'
    // 6. Return structured data with display names, never UUIDs
  },
})
```

Key conventions:
- `fuzzyNameMatch()` for all company/contact name searches (splits words, ANDs ILIKE)
- `pgUuidArray()` for safe Postgres array literals in `ANY()` clauses
- Metrics and key role definitions use hierarchical override: `DISTINCT ON (key) ORDER BY priority` (org_unit > enterprise > global)
- Composite tools (`brief-me`, `my-day-today`, `weekly-digest`) run parallel DB queries directly, not via sub-tool calls

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Shared Arali Postgres connection string |
| `JWT_SECRET` | Yes | Same as arali-main (HS256) |
| `ANTHROPIC_API_KEY` | Yes* | Claude API key (*required if AI_PROVIDER=anthropic) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | No | Gemini API key |
| `OPENAI_API_KEY` | No | OpenAI API key (also used for semantic search embeddings) |
| `AI_PROVIDER` | No | `anthropic` (default), `google`, or `openai` |
| `AI_MODEL` | No | Override model name |
| `PORT` | No | Server port (default 4111) |

## Key Design Decisions

- **Separate schema**: Mastra internal tables (memory, storage) live in `mastra` PostgreSQL schema; Arali data is in `public`
- **No Redis**: Memory uses `PostgresStore` — simpler infra, sufficient for conversation history
- **Dynamic tools**: Write tools only injected for users with `meeting.create` capability
- **No RAG currently**: Transcript search uses tsvector (keyword) and pgvector (semantic) directly, not Mastra's RAG pipeline
