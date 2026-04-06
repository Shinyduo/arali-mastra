import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const searchThreadMessages = createTool({
  id: "search-thread-messages",
  description:
    "Full-text keyword search across email, Slack, and WhatsApp messages. " +
    "Returns matching messages with thread subject, sender, date, and channel. " +
    "Use for 'find emails about contract renewal' or 'Slack messages mentioning budget'.",
  inputSchema: z.object({
    query: z.string().describe("Search query (keywords or phrase)"),
    channel: z
      .enum(["email", "message", "whatsapp", "other"])
      .optional()
      .describe("Filter by communication channel"),
    companyName: z
      .string()
      .optional()
      .describe("Filter to messages related to this company"),
    startDate: z
      .string()
      .optional()
      .describe("Start date (YYYY-MM-DD)"),
    endDate: z
      .string()
      .optional()
      .describe("End date (YYYY-MM-DD)"),
    limit: z.number().int().min(1).max(30).optional().default(15),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 15;

    const rows = await db.execute(sql`
      SELECT
        tm.subject AS message_subject,
        tm.text_body,
        tm.from_email,
        tm.sent_at,
        tm.direction,
        th.subject AS thread_subject,
        th.channel,
        c.name AS company_name,
        ts_rank(tm.search_vector, plainto_tsquery('english', ${input.query})) AS rank
      FROM thread_messages tm
      JOIN threads th ON th.id = tm.thread_id
      LEFT JOIN interaction_company ic ON ic.interaction_id = th.interaction_id
      LEFT JOIN companies c ON c.id = ic.company_id
      WHERE tm.search_vector @@ plainto_tsquery('english', ${input.query})
        AND tm.enterprise_id = ${enterpriseId}
        ${input.channel ? sql`AND th.channel = ${input.channel}` : sql``}
        ${input.companyName ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}` : sql``}
        ${input.startDate ? sql`AND tm.sent_at >= ${input.startDate}::timestamptz` : sql``}
        ${input.endDate ? sql`AND tm.sent_at <= ${input.endDate}::timestamptz` : sql``}
        ${
          !getCompanyScope(capabilities)?.enterprise
            ? sql`AND ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`c.id` as any) ?? sql`TRUE`}`
            : sql``
        }
      ORDER BY rank DESC
      LIMIT ${limit}
    `);

    return {
      results: (rows as any[]).map((r: any) => {
        // Truncate body to first 200 chars for display
        const body = r.text_body
          ? r.text_body.length > 200
            ? r.text_body.slice(0, 200) + "…"
            : r.text_body
          : "—";
        return {
          threadSubject: r.thread_subject ?? "—",
          messageSubject: r.message_subject ?? "—",
          body,
          from: r.from_email ?? "Unknown",
          direction: r.direction,
          channel: r.channel,
          sentAt: r.sent_at
            ? new Date(r.sent_at).toISOString().slice(0, 10)
            : "—",
          company: r.company_name ?? "—",
        };
      }),
    };
  },
});
