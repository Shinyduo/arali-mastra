import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const searchTranscriptsSemantic = createTool({
  id: "search-transcripts-semantic",
  description:
    "Semantic search across meeting transcripts using vector similarity. " +
    "Better than keyword search for conceptual queries like 'discussions about scaling challenges' " +
    "or 'conversations where the customer expressed frustration'. " +
    "Use when keyword search doesn't capture the intent.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Natural language search query"),
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
    limit: z.number().int().min(1).max(20).optional().default(10),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 10;

    // Embed the query using OpenAI text-embedding-3-small (1536 dimensions)
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: input.query,
    });

    const vectorStr = `[${embedding.join(",")}]`;

    const rows = await db.execute(sql`
      SELECT
        tce.text AS chunk_text,
        tce.chunk_index,
        i.title AS meeting_title,
        i.start_at AS meeting_date,
        c.name AS company_name,
        1 - (tce.embedding <=> ${vectorStr}::vector) AS similarity
      FROM transcript_chunk_embedding tce
      JOIN transcript t ON t.id = tce.transcript_id
      JOIN interactions i ON i.id = t.interaction_id
      LEFT JOIN interaction_company ic ON ic.interaction_id = i.id
      LEFT JOIN companies c ON c.id = ic.company_id
      WHERE c.enterprise_id = ${enterpriseId}
        ${input.companyName ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}` : sql``}
        ${input.startDate ? sql`AND i.start_at >= ${input.startDate}::timestamptz` : sql``}
        ${input.endDate ? sql`AND i.start_at <= ${input.endDate}::timestamptz` : sql``}
        ${
          !getCompanyScope(capabilities)?.enterprise
            ? sql`AND ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`c.id` as any) ?? sql`TRUE`}`
            : sql``
        }
      ORDER BY tce.embedding <=> ${vectorStr}::vector ASC
      LIMIT ${limit}
    `);

    return {
      results: (rows as any[]).map((r: any) => ({
        text: r.chunk_text,
        similarity: r.similarity != null ? Number(r.similarity).toFixed(3) : "—",
        meetingTitle: r.meeting_title,
        meetingDate: r.meeting_date
          ? new Date(r.meeting_date).toISOString().slice(0, 10)
          : "—",
        company: r.company_name ?? "—",
      })),
    };
  },
});
