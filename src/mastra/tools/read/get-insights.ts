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

export const getInsights = createTool({
  id: "get-insights",
  description:
    "Get AI-extracted meeting insights: feature reception, objections, appreciations, competitor mentions. " +
    "For named-entity lookups ('mentions of Snowflake') use clusterNameQuery — fuzzy-matches cluster labels. " +
    "For conceptual queries ('features about performance', 'objections around pricing', 'appreciations for onboarding') " +
    "use semanticQuery — embeds the query and ranks insights by vector similarity. " +
    "Without either, returns clusters grouped by count. Combine with metricKey to narrow the type.",
  inputSchema: z.object({
    metricKey: z
      .enum([
        "feature_reception",
        "objections_handling",
        "appreciation_moments",
        "competitor_mentions",
      ])
      .optional()
      .describe("Filter by insight type"),
    companyName: z
      .string()
      .optional()
      .describe("Filter insights from meetings with this company"),
    clusterNameQuery: z
      .string()
      .optional()
      .describe(
        "Fuzzy-match filter on cluster label — best for named entities like competitors (e.g. 'snowflake' finds the Snowflake cluster)",
      ),
    semanticQuery: z
      .string()
      .optional()
      .describe(
        "Semantic ranking by vector similarity — best for conceptual queries about features, objections, or appreciations. When set, results are ranked individually (ignores groupByCluster).",
      ),
    startDate: z
      .string()
      .optional()
      .describe("Start date filter (ISO format YYYY-MM-DD)"),
    endDate: z
      .string()
      .optional()
      .describe("End date filter (ISO format YYYY-MM-DD)"),
    groupByCluster: z
      .boolean()
      .optional()
      .default(true)
      .describe("Group results by cluster name (ignored when semanticQuery is set)"),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 30;
    const groupByCluster = input.groupByCluster ?? true;

    const scope = getCompanyScope(capabilities);

    const metricKeyFilter = input.metricKey
      ? sql`AND mi.metric_key = ${input.metricKey}`
      : sql``;
    const startFilter = input.startDate
      ? sql`AND mi.created_at >= ${input.startDate}::date`
      : sql``;
    const endFilter = input.endDate
      ? sql`AND mi.created_at < (${input.endDate}::date + INTERVAL '1 day')`
      : sql``;
    const companyFilter = input.companyName
      ? sql`AND EXISTS (
          SELECT 1 FROM interaction_company ic
          JOIN companies c ON c.id = ic.company_id
          WHERE ic.interaction_id = mi.interaction_id
            AND ${fuzzyNameMatch(sql`c.name`, input.companyName)}
        )`
      : sql``;
    const clusterNameFilter = input.clusterNameQuery
      ? sql`AND EXISTS (
          SELECT 1 FROM insight_clusters icl2
          WHERE icl2.id = mi.cluster_id
            AND ${fuzzyNameMatch(sql`icl2.name`, input.clusterNameQuery)}
        )`
      : sql``;
    const rbacFilter = !scope?.enterprise
      ? sql`AND EXISTS (
          SELECT 1 FROM interaction_company ic
          WHERE ic.interaction_id = mi.interaction_id
            AND ${buildKeyRoleScopeClause(scope, userId, "company", sql`ic.company_id` as any) ?? sql`TRUE`}
        )`
      : sql``;

    // Semantic branch — rank individual insights by vector distance
    if (input.semanticQuery) {
      const { embedding } = await embed({
        model: openai.embedding("text-embedding-3-large"),
        value: input.semanticQuery,
      });
      const vectorStr = `[${embedding.join(",")}]`;

      const rows = await db.execute(sql`
        SELECT
          mi.metric_key,
          mi.details_json,
          mi.created_at,
          ic_cl.name AS cluster_name,
          1 - (mi.embedding <=> ${vectorStr}::vector) AS similarity
        FROM meeting_insights mi
        LEFT JOIN insight_clusters ic_cl ON ic_cl.id = mi.cluster_id
        WHERE mi.enterprise_id = ${enterpriseId}
          AND mi.embedding IS NOT NULL
          ${metricKeyFilter}
          ${startFilter}
          ${endFilter}
          ${companyFilter}
          ${clusterNameFilter}
          ${rbacFilter}
        ORDER BY mi.embedding <=> ${vectorStr}::vector ASC
        LIMIT ${limit}
      `);

      return {
        insights: (rows as any[]).map((r: any) => ({
          type: r.metric_key,
          cluster: r.cluster_name ?? "Unclustered",
          details: r.details_json,
          date: r.created_at
            ? new Date(r.created_at).toISOString().slice(0, 10)
            : "—",
          similarity:
            r.similarity != null ? Number(r.similarity).toFixed(3) : "—",
        })),
      };
    }

    if (groupByCluster) {
      const rows = await db.execute(sql`
        SELECT
          ic_cl.name AS cluster_name,
          mi.metric_key,
          COUNT(*)::int AS insight_count,
          MAX(mi.created_at) AS latest_at
        FROM meeting_insights mi
        LEFT JOIN insight_clusters ic_cl ON ic_cl.id = mi.cluster_id
        WHERE mi.enterprise_id = ${enterpriseId}
          ${metricKeyFilter}
          ${startFilter}
          ${endFilter}
          ${companyFilter}
          ${clusterNameFilter}
          ${rbacFilter}
        GROUP BY ic_cl.name, mi.metric_key
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
      `);

      return {
        clusters: (rows as any[]).map((r: any) => ({
          cluster: r.cluster_name ?? "Unclustered",
          type: r.metric_key,
          count: Number(r.insight_count),
          lastSeen: r.latest_at
            ? new Date(r.latest_at).toISOString().slice(0, 10)
            : "—",
        })),
      };
    }

    // Flat chronological list
    const rows = await db.execute(sql`
      SELECT
        mi.metric_key,
        mi.details_json,
        mi.created_at,
        ic_cl.name AS cluster_name
      FROM meeting_insights mi
      LEFT JOIN insight_clusters ic_cl ON ic_cl.id = mi.cluster_id
      WHERE mi.enterprise_id = ${enterpriseId}
        ${metricKeyFilter}
        ${startFilter}
        ${endFilter}
        ${companyFilter}
        ${clusterNameFilter}
        ${rbacFilter}
      ORDER BY mi.created_at DESC
      LIMIT ${limit}
    `);

    return {
      insights: (rows as any[]).map((r: any) => ({
        type: r.metric_key,
        cluster: r.cluster_name ?? "Unclustered",
        details: r.details_json,
        date: r.created_at
          ? new Date(r.created_at).toISOString().slice(0, 10)
          : "—",
      })),
    };
  },
});
