import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

/**
 * Build a safe Postgres array literal from a string array: '{uuid1,uuid2}'
 * Returns '{}' for empty arrays so ANY() returns false.
 */
function pgUuidArray(ids: string[]): ReturnType<typeof sql> {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  // Validate UUIDs to prevent injection
  const safe = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return sql.raw(`'{${safe.join(",")}}'::uuid[]`);
}

export const getMetrics = createTool({
  id: "get-metrics",
  description:
    "Query metric scores and data (NPS, CSAT, BANT, meeting summaries, talk ratio, etc.) from the metrics system. " +
    "Metrics are stored per-meeting or per-user-daily. Each metric has a key (e.g. 'nps_inferred', 'csat', 'bant', " +
    "'meeting_summary', 'talk_ratio', 'action_items', 'churn_threats'). " +
    "Use metricKey to filter by specific metric, or leave empty to see all available metrics. " +
    "Can filter by company, meeting, date range, or user. " +
    "Use this for 'What was the NPS score in last meeting with Acme?', 'Show me BANT scores', " +
    "'Meeting summary for Company X', or 'What metrics do we track?'.",
  inputSchema: z.object({
    metricKey: z
      .string()
      .optional()
      .describe(
        "Metric key to filter (e.g. 'nps_inferred', 'csat', 'bant', 'meeting_summary', 'talk_ratio'). " +
        "Leave empty to list available metrics.",
      ),
    companyName: z
      .string()
      .optional()
      .describe("Filter metrics from interactions with this company"),
    meetingTitle: z
      .string()
      .optional()
      .describe("Filter by meeting title (partial match)"),
    userEmail: z
      .string()
      .optional()
      .describe("Filter by user/rep email"),
    startDate: z
      .string()
      .optional()
      .describe("Start date (YYYY-MM-DD)"),
    endDate: z
      .string()
      .optional()
      .describe("End date (YYYY-MM-DD)"),
    grain: z
      .enum(["meeting", "daily", "user_daily"])
      .optional()
      .describe("Metric grain. Default: all grains."),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities, orgUnitIds } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;
    const ouArray = pgUuidArray(orgUnitIds);

    // If no metricKey, list available metrics definitions
    // Uses hierarchical override: org_unit > enterprise > global
    if (!input.metricKey && !input.companyName && !input.meetingTitle) {
      const defs = await db.execute(sql`
        WITH ranked_metrics AS (
          SELECT
            m.key,
            m.name,
            m.description,
            m.data_type,
            m.unit,
            m.scope_kind,
            m.higher_is_better,
            CASE
              WHEN m.enterprise_id = ${enterpriseId} AND m.org_unit_id = ANY(${ouArray}) THEN 1
              WHEN m.enterprise_id = ${enterpriseId} AND m.org_unit_id IS NULL THEN 2
              WHEN m.enterprise_id IS NULL AND m.org_unit_id IS NULL THEN 3
              ELSE 4
            END AS priority
          FROM metrics m
          WHERE (
            (m.enterprise_id IS NULL AND m.org_unit_id IS NULL)
            OR (m.enterprise_id = ${enterpriseId} AND m.org_unit_id IS NULL)
            OR (m.enterprise_id = ${enterpriseId} AND m.org_unit_id = ANY(${ouArray}))
          )
        )
        SELECT DISTINCT ON (key) key, name, description, data_type, unit, scope_kind, higher_is_better
        FROM ranked_metrics
        WHERE priority < 4
        ORDER BY key, priority ASC
      `);

      return {
        availableMetrics: (defs as any[]).map((d: any) => ({
          key: d.key,
          name: d.name,
          description: d.description,
          dataType: d.data_type,
          unit: d.unit,
          scope: d.scope_kind,
          higherIsBetter: d.higher_is_better,
        })),
        hint: "Use metricKey to query specific metric values.",
      };
    }

    // Query metric values — join metrics with hierarchical override to resolve the right metric ID
    const rows = await db.execute(sql`
      WITH effective_metrics AS (
        SELECT DISTINCT ON (m.key)
          m.id,
          m.key,
          m.name,
          m.data_type,
          m.unit,
          CASE
            WHEN m.enterprise_id = ${enterpriseId} AND m.org_unit_id = ANY(${ouArray}) THEN 1
            WHEN m.enterprise_id = ${enterpriseId} AND m.org_unit_id IS NULL THEN 2
            WHEN m.enterprise_id IS NULL AND m.org_unit_id IS NULL THEN 3
            ELSE 4
          END AS priority
        FROM metrics m
        WHERE (
          (m.enterprise_id IS NULL AND m.org_unit_id IS NULL)
          OR (m.enterprise_id = ${enterpriseId} AND m.org_unit_id IS NULL)
          OR (m.enterprise_id = ${enterpriseId} AND m.org_unit_id = ANY(${ouArray}))
        )
        ${input.metricKey ? sql`AND m.key = ${input.metricKey}` : sql``}
        ORDER BY m.key, priority ASC
      )
      SELECT
        em.key AS metric_key,
        em.name AS metric_name,
        em.data_type,
        em.unit,
        md.value_number,
        md.value_text,
        md.value_json,
        md.grain,
        md.date,
        md.computed_at,
        i.title AS interaction_title,
        i.kind AS interaction_kind,
        i.start_at AS interaction_date,
        c.name AS company_name,
        au.name AS user_name,
        au.email AS user_email
      FROM metrics_data md
      JOIN effective_metrics em ON em.id = md.metric_id
      LEFT JOIN interactions i ON i.id = md.interaction_id
      LEFT JOIN interaction_company ic ON ic.interaction_id = i.id
      LEFT JOIN companies c ON c.id = ic.company_id
      LEFT JOIN app_user au ON au.id = md.user_id
      WHERE md.enterprise_id = ${enterpriseId}
        ${input.grain ? sql`AND md.grain = ${input.grain}` : sql``}
        ${input.companyName ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}` : sql``}
        ${input.meetingTitle ? sql`AND i.title ILIKE ${"%" + input.meetingTitle + "%"}` : sql``}
        ${input.userEmail ? sql`AND au.email = ${input.userEmail}` : sql``}
        ${input.startDate ? sql`AND COALESCE(md.date, md.computed_at) >= ${input.startDate}::timestamptz` : sql``}
        ${input.endDate ? sql`AND COALESCE(md.date, md.computed_at) <= ${input.endDate}::timestamptz` : sql``}
        ${
          !getCompanyScope(capabilities)?.enterprise
            ? sql`AND (
                c.id IS NULL OR
                ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`c.id` as any) ?? sql`TRUE`}
              )`
            : sql``
        }
      ORDER BY COALESCE(md.date, md.computed_at) DESC
      LIMIT ${limit}
    `);

    return {
      metrics: (rows as any[]).map((r: any) => {
        const value =
          r.value_json != null
            ? r.value_json
            : r.value_number != null
              ? Number(r.value_number)
              : r.value_text;

        return {
          metric: r.metric_name,
          key: r.metric_key,
          value,
          unit: r.unit,
          grain: r.grain,
          date: r.date
            ? new Date(r.date).toISOString().slice(0, 10)
            : r.computed_at
              ? new Date(r.computed_at).toISOString().slice(0, 10)
              : "—",
          interaction: r.interaction_title ?? null,
          interactionType: r.interaction_kind ?? null,
          company: r.company_name ?? null,
          user: r.user_name ?? null,
        };
      }),
    };
  },
});
