import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import {
  extractContext,
  getCompanyScope,
  buildKeyRoleScopeClause,
  fuzzyNameMatch,
} from "../../../lib/rbac.js";

const CANDIDATE_POOL = 50;
const RRF_K = 60;

export const searchTicketMessages = createTool({
  id: "search-ticket-messages",
  description:
    "Search support ticket messages by meaning or keyword (hybrid). " +
    "Use for exact-phrase queries ('tickets mentioning timeout'), conceptual queries " +
    "('tickets where users expressed frustration'), or mixed queries ('tickets about login errors'). " +
    "Combines full-text (tsvector) and semantic (embedding) ranking via Reciprocal Rank Fusion.",
  inputSchema: z.object({
    query: z.string().describe("Natural language or keyword query"),
    companyName: z
      .string()
      .optional()
      .describe("Filter to tickets for this company"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().int().min(1).max(30).optional().default(15),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );
    const limit = input.limit ?? 15;

    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: input.query,
    });
    const vectorStr = `[${embedding.join(",")}]`;

    const companyFilter = input.companyName
      ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName)}`
      : sql``;
    const startFilter = input.startDate
      ? sql`AND tm.sent_at >= ${input.startDate}::date`
      : sql``;
    const endFilter = input.endDate
      ? sql`AND tm.sent_at < (${input.endDate}::date + INTERVAL '1 day')`
      : sql``;
    const scope = getCompanyScope(capabilities);
    const rbacFilter = !scope?.enterprise
      ? sql`AND ${buildKeyRoleScopeClause(scope, userId, "company", sql`c.id` as any) ?? sql`TRUE`}`
      : sql``;

    const rows = await db.execute(sql`
      WITH kw AS (
        SELECT tm.id,
               row_number() OVER (ORDER BY ts_rank(tm.search_vector, q) DESC) AS pos,
               ts_rank(tm.search_vector, q) AS ts_score
        FROM ticket_messages tm
        JOIN tickets t ON t.id = tm.ticket_id
        LEFT JOIN interaction_company ic ON ic.interaction_id = t.interaction_id
        LEFT JOIN companies c ON c.id = ic.company_id,
             plainto_tsquery('english', ${input.query}) q
        WHERE tm.enterprise_id = ${enterpriseId}
          AND tm.search_vector @@ q
          ${companyFilter}
          ${startFilter}
          ${endFilter}
          ${rbacFilter}
        LIMIT ${CANDIDATE_POOL}
      ),
      vec AS (
        SELECT tm.id,
               row_number() OVER (ORDER BY tm.embedding <=> ${vectorStr}::vector ASC) AS pos,
               1 - (tm.embedding <=> ${vectorStr}::vector) AS vec_score
        FROM ticket_messages tm
        JOIN tickets t ON t.id = tm.ticket_id
        LEFT JOIN interaction_company ic ON ic.interaction_id = t.interaction_id
        LEFT JOIN companies c ON c.id = ic.company_id
        WHERE tm.enterprise_id = ${enterpriseId}
          AND tm.embedding IS NOT NULL
          ${companyFilter}
          ${startFilter}
          ${endFilter}
          ${rbacFilter}
        LIMIT ${CANDIDATE_POOL}
      )
      SELECT
        tm.subject AS message_subject,
        tm.text_body,
        tm.from_email,
        tm.sent_at,
        tm.direction,
        t.subject AS ticket_subject,
        t.status AS ticket_status,
        c.name AS company_name,
        COALESCE(1.0 / (${RRF_K} + kw.pos), 0) + COALESCE(1.0 / (${RRF_K} + vec.pos), 0) AS rrf,
        kw.ts_score,
        vec.vec_score
      FROM ticket_messages tm
      LEFT JOIN kw ON kw.id = tm.id
      LEFT JOIN vec ON vec.id = tm.id
      JOIN tickets t ON t.id = tm.ticket_id
      LEFT JOIN interaction_company ic ON ic.interaction_id = t.interaction_id
      LEFT JOIN companies c ON c.id = ic.company_id
      WHERE (kw.id IS NOT NULL OR vec.id IS NOT NULL)
      ORDER BY rrf DESC
      LIMIT ${limit}
    `);

    return {
      results: (rows as any[]).map((r: any) => {
        const body = r.text_body
          ? r.text_body.length > 200
            ? r.text_body.slice(0, 200) + "…"
            : r.text_body
          : "—";
        return {
          ticketSubject: r.ticket_subject ?? "—",
          ticketStatus: r.ticket_status ?? "—",
          messageSubject: r.message_subject ?? "—",
          body,
          from: r.from_email ?? "Unknown",
          direction: r.direction,
          sentAt: r.sent_at
            ? new Date(r.sent_at).toISOString().slice(0, 10)
            : "—",
          company: r.company_name ?? "—",
          tsScore: r.ts_score != null ? Number(r.ts_score).toFixed(3) : null,
          vecScore: r.vec_score != null ? Number(r.vec_score).toFixed(3) : null,
        };
      }),
    };
  },
});
