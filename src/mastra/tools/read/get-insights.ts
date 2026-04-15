import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  meetingInsights,
  insightClusters,
  interactions,
  interactionCompany,
  companies,
} from "../../../db/schema.js";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
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
    "For named-entity lookups ('mentions of Snowflake') use `clusterNameQuery` — fuzzy-matches cluster labels. " +
    "For conceptual queries ('features about performance', 'objections around pricing', 'appreciations for onboarding') " +
    "use `semanticQuery` — embeds the query and ranks insights by vector similarity. " +
    "Without either, returns clusters grouped by count. Combine with `metricKey` to narrow the type.",
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

    const conditions = [
      eq(meetingInsights.enterpriseId, enterpriseId),
      input.metricKey
        ? eq(meetingInsights.metricKey, input.metricKey)
        : undefined,
      input.startDate
        ? gte(meetingInsights.createdAt, new Date(input.startDate))
        : undefined,
      input.endDate
        ? lte(meetingInsights.createdAt, new Date(input.endDate))
        : undefined,
      input.companyName
        ? sql`EXISTS (
            SELECT 1 FROM interaction_company ic
            JOIN companies c ON c.id = ic.company_id
            WHERE ic.interaction_id = ${meetingInsights.interactionId}
              AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}
          )`
        : undefined,
      input.clusterNameQuery
        ? sql`EXISTS (
            SELECT 1 FROM insight_clusters icl
            WHERE icl.id = ${meetingInsights.clusterId}
              AND ${fuzzyNameMatch(sql`icl.name`, input.clusterNameQuery)}
          )`
        : undefined,
      !getCompanyScope(capabilities)?.enterprise
        ? sql`EXISTS (
            SELECT 1 FROM interaction_company ic
            WHERE ic.interaction_id = ${meetingInsights.interactionId}
              AND ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`ic.company_id` as any) ?? sql`TRUE`}
          )`
        : undefined,
    ].filter(Boolean);

    // Semantic search branch — rank individual insights by vector distance
    if (input.semanticQuery) {
      const { embedding } = await embed({
        model: openai.embedding("text-embedding-3-large"),
        value: input.semanticQuery,
      });
      const vectorStr = `[${embedding.join(",")}]`;

      conditions.push(sql`${meetingInsights.embedding} IS NOT NULL`);

      const rows = await db
        .select({
          metricKey: meetingInsights.metricKey,
          details: meetingInsights.detailsJson,
          clusterName: sql<string>`ic_cl.name`.as("cluster_name"),
          createdAt: meetingInsights.createdAt,
          similarity: sql<number>`1 - (${meetingInsights.embedding} <=> ${vectorStr}::vector)`.as(
            "similarity",
          ),
        })
        .from(meetingInsights)
        .leftJoin(
          sql`insight_clusters ic_cl`,
          sql`ic_cl.id = ${meetingInsights.clusterId}`,
        )
        .where(and(...conditions))
        .orderBy(sql`${meetingInsights.embedding} <=> ${vectorStr}::vector ASC`)
        .limit(limit);

      return {
        insights: rows.map((r) => ({
          type: r.metricKey,
          cluster: r.clusterName ?? "Unclustered",
          details: r.details,
          date: r.createdAt?.toISOString().slice(0, 10) ?? "—",
          similarity:
            r.similarity != null ? Number(r.similarity).toFixed(3) : "—",
        })),
      };
    }

    if (groupByCluster) {
      const rows = await db
        .select({
          clusterName: sql<string>`ic_cl.name`.as("cluster_name"),
          metricKey: meetingInsights.metricKey,
          insightCount: count(),
          latestAt: sql<Date>`MAX(${meetingInsights.createdAt})`.as("latest_at"),
        })
        .from(meetingInsights)
        .leftJoin(
          sql`insight_clusters ic_cl`,
          sql`ic_cl.id = ${meetingInsights.clusterId}`,
        )
        .where(and(...conditions))
        .groupBy(sql`ic_cl.name`, meetingInsights.metricKey)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      return {
        clusters: rows.map((r) => ({
          cluster: r.clusterName ?? "Unclustered",
          type: r.metricKey,
          count: Number(r.insightCount),
          lastSeen: r.latestAt
            ? new Date(r.latestAt).toISOString().slice(0, 10)
            : "—",
        })),
      };
    }

    // Flat chronological list
    const rows = await db
      .select({
        metricKey: meetingInsights.metricKey,
        details: meetingInsights.detailsJson,
        clusterName: sql<string>`ic_cl.name`.as("cluster_name"),
        createdAt: meetingInsights.createdAt,
      })
      .from(meetingInsights)
      .leftJoin(
        sql`insight_clusters ic_cl`,
        sql`ic_cl.id = ${meetingInsights.clusterId}`,
      )
      .where(and(...conditions))
      .orderBy(desc(meetingInsights.createdAt))
      .limit(limit);

    return {
      insights: rows.map((r) => ({
        type: r.metricKey,
        cluster: r.clusterName ?? "Unclustered",
        details: r.details,
        date: r.createdAt?.toISOString().slice(0, 10) ?? "—",
      })),
    };
  },
});
