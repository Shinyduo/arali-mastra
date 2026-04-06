import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, buildCompanyScopeFilter } from "../../../lib/rbac.js";

export const getInteractionTimeline = createTool({
  id: "get-interaction-timeline",
  description:
    "Get a chronological timeline of all interactions (meetings, calls, emails, tickets) with a company. " +
    "Use for 'last 10 interactions with Acme', 'meeting history for Company X', or 'recent calls with this account'.",
  inputSchema: z.object({
    companyName: z
      .string()
      .optional()
      .describe("Company name (partial match)"),
    companyId: z.string().uuid().optional().describe("Exact company UUID"),
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
    const { enterpriseId, userId, userRole, orgUnitIds } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;

    if (!input.companyName && !input.companyId) {
      return { error: "Either companyName or companyId is required" };
    }

    const rows = await db.execute(sql`
      SELECT
        i.kind,
        i.title,
        i.summary,
        i.start_at,
        i.end_at,
        i.source,
        c.name AS company_name
      FROM interactions i
      JOIN interaction_company ic ON ic.interaction_id = i.id
      JOIN companies c ON c.id = ic.company_id
      WHERE ic.enterprise_id = ${enterpriseId}
        ${input.companyId ? sql`AND c.id = ${input.companyId}::uuid` : sql``}
        ${input.companyName ? sql`AND c.name ILIKE ${"%" + input.companyName + "%"}` : sql``}
        ${input.kind ? sql`AND i.kind = ${input.kind}` : sql``}
        ${input.startDate ? sql`AND i.start_at >= ${input.startDate}::timestamptz` : sql``}
        ${input.endDate ? sql`AND i.start_at <= ${input.endDate}::timestamptz` : sql``}
        ${
          userRole !== "admin"
            ? sql`AND ${buildCompanyScopeFilter(userRole, userId, orgUnitIds, sql`c.id` as any) ?? sql`TRUE`}`
            : sql``
        }
      ORDER BY i.start_at DESC NULLS LAST
      LIMIT ${limit}
    `);

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
        company: r.company_name,
      })),
    };
  },
});
