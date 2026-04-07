import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch, pgUuidArray } from "../../../lib/rbac.js";

export const getInteractionTimeline = createTool({
  id: "get-interaction-timeline",
  description:
    "Get a chronological timeline of interactions (meetings, calls, emails, tickets). " +
    "Can filter by company, user (team member), kind, or date range. " +
    "If no filters given, returns recent interactions across all companies the user has access to. " +
    "Use for 'last 10 interactions with Acme', 'Himanshu's recent meetings', " +
    "'calls by John this week', 'my interactions today', " +
    "'show me all recent interactions', or 'what happened across my portfolio this week?'.",
  inputSchema: z.object({
    companyName: z
      .string()
      .optional()
      .describe("Filter by company name (partial match)"),
    companyId: z.string().uuid().optional().describe("Exact company UUID"),
    userEmail: z
      .string()
      .email()
      .optional()
      .describe("Filter by team member's email (use get-team-members to resolve names). " +
        "Shows interactions where this user was a participant."),
    kind: z
      .enum(["meeting", "call", "thread", "ticket", "note"])
      .optional()
      .describe("Filter by interaction type"),
    startDate: z
      .string()
      .optional()
      .describe("Start date (YYYY-MM-DD)"),
    endDate: z
      .string()
      .optional()
      .describe("End date (YYYY-MM-DD)"),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;
    const hasCompanyFilter = !!(input.companyName || input.companyId);
    const hasUserFilter = !!input.userEmail;
    const scope = getCompanyScope(capabilities);

    // Main query for interactions — deduplicate in subquery, sort by date in outer query
    const rows = await db.execute(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (i.id)
          i.id,
          i.kind,
          i.title,
          i.summary,
          i.start_at,
          i.end_at,
          i.source,
          c.name AS company_name
        FROM interactions i
        LEFT JOIN interaction_company ic ON ic.interaction_id = i.id AND ic.enterprise_id = ${enterpriseId}
        LEFT JOIN companies c ON c.id = ic.company_id
        ${hasUserFilter ? sql`
          JOIN participants p_user ON p_user.interaction_id = i.id
            AND p_user.user_id = (SELECT id FROM app_user WHERE email = ${input.userEmail} LIMIT 1)
        ` : sql``}
        WHERE (
          ic.enterprise_id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM participants p_self
            WHERE p_self.interaction_id = i.id AND p_self.user_id = ${userId}
          )
        )
        ${input.companyId ? sql`AND c.id = ${input.companyId}::uuid` : sql``}
        ${input.companyName ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}` : sql``}
        ${input.kind ? sql`AND i.kind = ${input.kind}` : sql``}
        ${input.startDate ? sql`AND i.start_at >= ${input.startDate}::date` : sql``}
        ${input.endDate ? sql`AND i.start_at < (${input.endDate}::date + INTERVAL '1 day')` : sql``}
        ${
          !scope?.enterprise
            ? sql`AND (
                c.id IS NULL OR
                ${buildKeyRoleScopeClause(scope, userId, "company", sql`c.id` as any) ?? sql`TRUE`}
              )`
            : sql``
        }
        ORDER BY i.id
      ) AS deduped
      ORDER BY start_at DESC NULLS LAST
      LIMIT ${limit}
    `);

    // Fetch participants for the returned interactions
    const interactionIds = (rows as any[]).map((r: any) => r.id).filter(Boolean);
    let participantsMap: Record<string, string[]> = {};
    if (interactionIds.length > 0) {
      const participants = await db.execute(sql`
        SELECT p.interaction_id, p.display_name
        FROM participants p
        WHERE p.interaction_id = ANY(${pgUuidArray(interactionIds)})
        ORDER BY p.interaction_id, p.display_name
      `);
      for (const p of participants as any[]) {
        const iid = p.interaction_id as string;
        if (!participantsMap[iid]) participantsMap[iid] = [];
        if (p.display_name) participantsMap[iid].push(p.display_name);
      }
    }

    return {
      interactions: (rows as any[]).map((r: any) => ({
        type: r.kind,
        title: r.title,
        summary: r.summary
          ? r.summary.length > 300
            ? r.summary.slice(0, 300) + "…"
            : r.summary
          : "—",
        date: r.start_at
          ? new Date(r.start_at).toISOString().slice(0, 10)
          : "—",
        endDate: r.end_at
          ? new Date(r.end_at).toISOString().slice(0, 10)
          : null,
        source: r.source,
        company: r.company_name ?? "—",
        participants: participantsMap[r.id] ?? [],
      })),
    };
  },
});
