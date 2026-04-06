import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  transcript,
  transcriptSegments,
  meetings,
  interactions,
  interactionCompany,
  companies,
  participants,
} from "../../../db/schema.js";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const searchTranscriptsKeyword = createTool({
  id: "search-transcripts-keyword",
  description:
    "Full-text keyword search across meeting transcripts using PostgreSQL tsvector. " +
    "Returns matching transcript segments with speaker, timestamp, meeting title, and company. " +
    "Use for 'who mentioned pricing in calls with Acme?' or 'find discussions about migration'.",
  inputSchema: z.object({
    query: z.string().describe("Search query (keywords or phrase)"),
    companyName: z
      .string()
      .optional()
      .describe("Filter to meetings with this company"),
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

    // Use raw SQL for the full-text search with GIN index
    const rows = await db.execute(sql`
      SELECT
        ts.text AS segment_text,
        ts.speaker_name,
        ts.start_ms,
        i.title AS meeting_title,
        i.start_at AS meeting_date,
        c.name AS company_name,
        ts_rank(t.search_vector, plainto_tsquery('english', ${input.query})) AS rank
      FROM transcript t
      JOIN transcript_segments ts ON ts.transcript_id = t.id
      JOIN interactions i ON i.id = t.interaction_id
      LEFT JOIN interaction_company ic ON ic.interaction_id = i.id
      LEFT JOIN companies c ON c.id = ic.company_id
      WHERE t.search_vector @@ plainto_tsquery('english', ${input.query})
        ${input.companyName ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}` : sql``}
        ${input.startDate ? sql`AND i.start_at >= ${input.startDate}::date` : sql``}
        ${input.endDate ? sql`AND i.start_at < (${input.endDate}::date + INTERVAL '1 day')` : sql``}
        ${
          !getCompanyScope(capabilities)?.enterprise
            ? sql`AND (
                c.enterprise_id = ${enterpriseId}
                AND ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`c.id` as any) ?? sql`TRUE`}
              )`
            : sql`AND c.enterprise_id = ${enterpriseId}`
        }
      ORDER BY rank DESC
      LIMIT ${limit}
    `);

    return {
      results: (rows as any[]).map((r: any) => ({
        text: r.segment_text,
        speaker: r.speaker_name ?? "Unknown",
        timestampMs: r.start_ms,
        meetingTitle: r.meeting_title,
        meetingDate: r.meeting_date
          ? new Date(r.meeting_date).toISOString().slice(0, 10)
          : "—",
        company: r.company_name ?? "—",
      })),
    };
  },
});
