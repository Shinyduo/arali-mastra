import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause } from "../../../lib/rbac.js";

export const getPortfolioHealthTrend = createTool({
  id: "get-portfolio-health-trend",
  description:
    "Get health score trends across companies over time. " +
    "Use for 'portfolio health trend this quarter', 'average health by stage', " +
    "or 'how has my portfolio health changed over the last 6 months?'.",
  inputSchema: z.object({
    startDate: z
      .string()
      .optional()
      .describe("Start date (YYYY-MM-DD). Defaults to 30 days ago."),
    endDate: z
      .string()
      .optional()
      .describe("End date (YYYY-MM-DD). Defaults to today."),
    granularity: z
      .enum(["daily", "weekly", "monthly"])
      .optional()
      .default("weekly")
      .describe("Time bucketing"),
    groupBy: z
      .enum(["none", "owner", "stage"])
      .optional()
      .default("none")
      .describe("Group results by owner or stage"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const granularity = input.granularity ?? "weekly";
    const groupBy = input.groupBy ?? "none";

    const startDate =
      input.startDate ??
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const endDate =
      input.endDate ?? new Date().toISOString().slice(0, 10);

    const truncExpr = {
      daily: sql`date_trunc('day', emh.effective_at)`,
      weekly: sql`date_trunc('week', emh.effective_at)`,
      monthly: sql`date_trunc('month', emh.effective_at)`,
    }[granularity];

    let groupCol = sql`NULL`;
    let groupJoin = sql``;
    if (groupBy === "owner") {
      groupCol = sql`au.name`;
      groupJoin = sql`LEFT JOIN companies c ON c.id = emh.entity_id LEFT JOIN app_user au ON au.id = c.owner_user_id`;
    } else if (groupBy === "stage") {
      groupCol = sql`sd.name`;
      groupJoin = sql`LEFT JOIN companies c ON c.id = emh.entity_id LEFT JOIN stage_definition sd ON sd.id = c.stage_definition_id`;
    }

    const rbacWhere =
      !getCompanyScope(capabilities)?.enterprise
        ? sql`AND ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`emh.entity_id` as any) ?? sql`TRUE`}`
        : sql``;

    const rows = await db.execute(sql`
      SELECT
        ${truncExpr} AS period,
        ${groupBy !== "none" ? groupCol : sql`NULL`} AS group_label,
        ROUND(AVG(emh.value_number::numeric), 2) AS avg_health,
        COUNT(DISTINCT emh.entity_id) AS company_count
      FROM entity_metric_history emh
      ${groupBy !== "none" ? groupJoin : sql``}
      WHERE emh.enterprise_id = ${enterpriseId}
        AND emh.entity_type = 'company'
        AND emh.metric_key = 'health_score'
        AND emh.effective_at >= ${startDate}::date
        AND emh.effective_at < (${endDate}::date + INTERVAL '1 day')
        ${rbacWhere}
      GROUP BY period${groupBy !== "none" ? sql`, group_label` : sql``}
      ORDER BY period ASC${groupBy !== "none" ? sql`, group_label` : sql``}
    `);

    return {
      trend: (rows as any[]).map((r: any) => ({
        period: r.period
          ? new Date(r.period).toISOString().slice(0, 10)
          : "—",
        group: r.group_label ?? "All",
        avgHealth: r.avg_health != null ? Number(r.avg_health) : null,
        companyCount: Number(r.company_count),
      })),
      dateRange: { from: startDate, to: endDate },
      granularity,
    };
  },
});
