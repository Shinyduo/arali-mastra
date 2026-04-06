import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getSignalDetails = createTool({
  id: "get-signal-details",
  description:
    "Get detailed evidence for a company signal — including all occurrences, their linked interactions, " +
    "and transcript summaries. Use this when the user asks 'why is Company X showing a churn signal?' " +
    "or 'look into the interaction behind this signal'. Returns occurrences with evidence JSON, " +
    "trigger types, and transcript text from the linked interactions.",
  inputSchema: z.object({
    companyName: z.string().describe("Company name (partial match)"),
    signalTitle: z
      .string()
      .optional()
      .describe("Signal title to narrow down (partial match). If omitted, returns details for the most recent signal."),
    categoryKey: z
      .string()
      .optional()
      .describe("Signal category key (e.g. 'churn', 'contraction_seats')"),
    includeTranscripts: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, fetch transcript text for linked interactions"),
    limit: z.number().int().min(1).max(20).optional().default(10),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 10;
    const includeTranscripts = input.includeTranscripts ?? true;

    // Step 1: Find the signal
    const signals = await db.execute(sql`
      SELECT
        cs.id AS signal_id,
        cs.title,
        cs.type,
        cs.category_key,
        cs.severity,
        cs.status,
        cs.first_seen_at,
        cs.last_seen_at,
        c.name AS company_name
      FROM company_signal cs
      JOIN companies c ON c.id = cs.company_id
      WHERE cs.enterprise_id = ${enterpriseId}
        AND ${fuzzyNameMatch(sql`c.name`, input.companyName)}
        ${input.signalTitle ? sql`AND cs.title ILIKE ${"%" + input.signalTitle + "%"}` : sql``}
        ${input.categoryKey ? sql`AND cs.category_key = ${input.categoryKey}` : sql``}
        ${
          !getCompanyScope(capabilities)?.enterprise
            ? sql`AND ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`c.id` as any) ?? sql`TRUE`}`
            : sql``
        }
      ORDER BY cs.last_seen_at DESC
      LIMIT 1
    `);

    const signal = (signals as any[])[0];
    if (!signal) {
      return { error: `No signal found for "${input.companyName}"${input.signalTitle ? ` matching "${input.signalTitle}"` : ""}.` };
    }

    // Step 2: Get all occurrences with interaction details
    const occurrences = await db.execute(sql`
      SELECT
        cso.id AS occurrence_id,
        cso.detected_at,
        cso.source,
        cso.trigger_type,
        cso.severity,
        cso.timeline_urgency,
        cso.recoverability,
        cso.evidence_json,
        cso.interaction_id,
        i.title AS interaction_title,
        i.kind AS interaction_kind,
        i.start_at AS interaction_date,
        i.summary AS interaction_summary
      FROM company_signal_occurrence cso
      LEFT JOIN interactions i ON i.id = cso.interaction_id
      WHERE cso.signal_id = ${signal.signal_id}
      ORDER BY cso.detected_at DESC
      LIMIT ${limit}
    `);

    // Step 3: Fetch transcripts for linked interactions if requested
    let transcriptMap: Record<string, string> = {};
    if (includeTranscripts) {
      const interactionIds = (occurrences as any[])
        .map((o: any) => o.interaction_id)
        .filter(Boolean);

      if (interactionIds.length > 0) {
        const transcripts = await db.execute(sql`
          SELECT
            t.interaction_id,
            t.full_text
          FROM transcript t
          WHERE t.interaction_id = ANY(${interactionIds}::uuid[])
        `);

        for (const t of transcripts as any[]) {
          if (t.full_text) {
            // Truncate to first 1000 chars per transcript to keep response manageable
            transcriptMap[t.interaction_id] = t.full_text.length > 1000
              ? t.full_text.slice(0, 1000) + "…"
              : t.full_text;
          }
        }
      }
    }

    return {
      signal: {
        title: signal.title,
        type: signal.type,
        category: signal.category_key,
        severity: signal.severity,
        status: signal.status,
        company: signal.company_name,
        firstSeen: signal.first_seen_at
          ? new Date(signal.first_seen_at).toISOString().slice(0, 10)
          : "—",
        lastSeen: signal.last_seen_at
          ? new Date(signal.last_seen_at).toISOString().slice(0, 10)
          : "—",
      },
      occurrences: (occurrences as any[]).map((o: any) => ({
        detectedAt: o.detected_at
          ? new Date(o.detected_at).toISOString().slice(0, 10)
          : "—",
        source: o.source,
        triggerType: o.trigger_type ?? "—",
        severity: o.severity ?? "—",
        urgency: o.timeline_urgency ?? "—",
        recoverability: o.recoverability ?? "—",
        evidence: o.evidence_json,
        interaction: o.interaction_id
          ? {
              title: o.interaction_title ?? "—",
              type: o.interaction_kind ?? "—",
              date: o.interaction_date
                ? new Date(o.interaction_date).toISOString().slice(0, 10)
                : "—",
              summary: o.interaction_summary ?? null,
              transcript: transcriptMap[o.interaction_id] ?? null,
            }
          : null,
      })),
    };
  },
});
