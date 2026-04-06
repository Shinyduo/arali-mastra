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
import { extractContext, buildCompanyScopeFilter, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getInsights = createTool({
  id: "get-insights",
  description:
    "Get meeting insights grouped by cluster. Insights are AI-extracted signals from meetings: " +
    "feature requests, objections, competitor mentions, issues. " +
    "Use this for 'top feature requests', 'common objections', 'competitor mentions for Company X'.",
  inputSchema: z.object({
    metricKey: z
      .enum(["feature", "objection", "issue", "competitor_mention"])
      .optional()
      .describe("Filter by insight type"),
    companyName: z
      .string()
      .optional()
      .describe("Filter insights from meetings with this company"),
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
      .describe("Group results by cluster name"),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, userRole, orgUnitIds } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 30;
    const groupByCluster = input.groupByCluster ?? true;

    // Build base query with company RBAC through interaction chain
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
      // RBAC: scope to companies the user can see
      userRole !== "admin"
        ? sql`EXISTS (
            SELECT 1 FROM interaction_company ic
            WHERE ic.interaction_id = ${meetingInsights.interactionId}
              AND ${buildCompanyScopeFilter(userRole, userId, orgUnitIds, sql`ic.company_id` as any) ?? sql`TRUE`}
          )`
        : undefined,
    ].filter(Boolean);

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

    // Flat list
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
