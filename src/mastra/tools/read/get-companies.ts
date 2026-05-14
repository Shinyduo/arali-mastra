import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companies, stageDefinition, entityActivityLogs } from "../../../db/schema.js";
import { eq, and, gte, lte, asc, desc, sql, count } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch, pgUuidArray } from "../../../lib/rbac.js";

export const getCompanies = createTool({
  id: "get-companies",
  description:
    "List companies with optional filters for health score, stage, ARR, owner, domain, name search, " +
    "creation date, inactivity, stage duration, or custom field values. Companies may have enterprise-defined custom fields " +
    "(e.g. 'contract_value', 'industry', 'region'). Use customFieldFilters to filter by them, " +
    "and set includeCustomFields=true to return their values. Use this for list/comparison queries " +
    "like 'show me at-risk companies', 'companies with ARR over 100k', 'companies where region is APAC', " +
    "'new companies added today', 'which companies came in this week?', " +
    "'companies with no owner', 'untouched accounts in 30 days', 'companies with declining health', " +
    "or 'companies stuck at negotiation stage for 5 days' (use stageKey + daysSinceStageChange).",
  inputSchema: z.object({
    healthScoreMin: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Minimum health score (0-10 inclusive)"),
    healthScoreMax: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Maximum health score (0-10 inclusive)"),
    stageKey: z
      .string()
      .optional()
      .describe("Filter by stage key (e.g. 'onboarding', 'active', 'churned')"),
    arrMin: z.number().optional().describe("Minimum ARR value"),
    arrMax: z.number().optional().describe("Maximum ARR value"),
    ownerEmail: z
      .string()
      .email()
      .optional()
      .describe("Filter by assigned user's email (via key role assignments). Use for 'my companies' or 'companies assigned to X'."),
    hasNoOwner: z
      .boolean()
      .optional()
      .describe("If true, only show companies with no active key role assignments (no CSM, AE, etc.). Use for 'unassigned companies'."),
    daysSinceLastInteraction: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Only companies with no interactions in the last N days. Use for 'untouched accounts', 'companies not contacted in 30 days'."),
    healthTrend: z
      .enum(["declining", "improving", "stable"])
      .optional()
      .describe("Filter by health score trend direction over the last 30 days. 'declining' = dropped by 1+, 'improving' = rose by 1+, 'stable' = changed less than 1."),
    domain: z.string().optional().describe("Filter by company domain"),
    search: z
      .string()
      .optional()
      .describe("Search company name (case-insensitive partial match)"),
    createdAfter: z
      .string()
      .optional()
      .describe("Only companies created on or after this date (YYYY-MM-DD). Use for 'new companies today', 'added this week'."),
    createdBefore: z
      .string()
      .optional()
      .describe("Only companies created on or before this date (YYYY-MM-DD)"),
    customFieldFilters: z
      .array(
        z.object({
          fieldKey: z.string().describe("Custom field key (e.g. 'region', 'contract_value')"),
          operator: z
            .enum(["is", "is_not", "contains", "gt", "lt", "gte", "lte", "is_empty", "not_empty"])
            .describe("Comparison operator"),
          value: z
            .string()
            .optional()
            .describe("Value to compare against (not needed for is_empty/not_empty)"),
        }),
      )
      .optional()
      .describe("Filter by custom field values. Each filter specifies a field key, operator, and value."),
    includeCustomFields: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, include custom field values in the response"),
    sortBy: z
      .enum(["healthScore", "arr", "name", "updatedAt", "createdAt"])
      .optional()
      .default("name")
      .describe("Sort field. Use 'createdAt' for newest-first queries."),
    sortOrder: z
      .enum(["asc", "desc"])
      .optional()
      .default("asc")
      .describe("Sort direction"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(25)
      .describe("Max results to return"),
    daysSinceStageChange: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Only companies whose stage has not changed in the last N days (i.e. stuck in current stage for at least N days). " +
        "Use with stageKey to find companies stuck at a particular stage. " +
        "E.g. stageKey='negotiation' + daysSinceStageChange=5 finds companies stuck in negotiation for 5+ days."
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("Offset for pagination"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const scopeFilter = buildKeyRoleScopeClause(
      getCompanyScope(capabilities),
      userId,
      "company",
    );

    const stage = stageDefinition;

    // Build custom field filter SQL fragments
    const customFieldConditions = (input.customFieldFilters ?? []).map((f) => {
      const valueCol = sql`COALESCE(fv_cf.value_text, fv_cf.value_number)`;

      let comparison: ReturnType<typeof sql>;
      switch (f.operator) {
        case "is":
          comparison = sql`${valueCol} = ${f.value}`;
          break;
        case "is_not":
          comparison = sql`${valueCol} != ${f.value}`;
          break;
        case "contains":
          comparison = sql`${valueCol} ILIKE ${"%" + (f.value ?? "") + "%"}`;
          break;
        case "gt":
          comparison = sql`fv_cf.value_number::numeric > ${f.value}::numeric`;
          break;
        case "lt":
          comparison = sql`fv_cf.value_number::numeric < ${f.value}::numeric`;
          break;
        case "gte":
          comparison = sql`fv_cf.value_number::numeric >= ${f.value}::numeric`;
          break;
        case "lte":
          comparison = sql`fv_cf.value_number::numeric <= ${f.value}::numeric`;
          break;
        case "is_empty":
          return sql`NOT EXISTS (
            SELECT 1 FROM field_values fv_cf
            JOIN field_definitions fd_cf ON fd_cf.id = fv_cf.field_definition_id
            WHERE fv_cf.entity_type IN ('company', 'companies')
              AND fv_cf.entity_id = ${companies.id}
              AND fd_cf.field_key = ${f.fieldKey}
              AND fd_cf.enterprise_id = ${enterpriseId}
          )`;
        case "not_empty":
          return sql`EXISTS (
            SELECT 1 FROM field_values fv_cf
            JOIN field_definitions fd_cf ON fd_cf.id = fv_cf.field_definition_id
            WHERE fv_cf.entity_type IN ('company', 'companies')
              AND fv_cf.entity_id = ${companies.id}
              AND fd_cf.field_key = ${f.fieldKey}
              AND fd_cf.enterprise_id = ${enterpriseId}
          )`;
        default:
          comparison = sql`${valueCol} = ${f.value}`;
      }

      return sql`EXISTS (
        SELECT 1 FROM field_values fv_cf
        JOIN field_definitions fd_cf ON fd_cf.id = fv_cf.field_definition_id
        WHERE fv_cf.entity_type IN ('company', 'companies')
          AND fv_cf.entity_id = ${companies.id}
          AND fd_cf.field_key = ${f.fieldKey}
          AND fd_cf.enterprise_id = ${enterpriseId}
          AND ${comparison}
      )`;
    });

    const conditions = [
      eq(companies.enterpriseId, enterpriseId),
      scopeFilter,
      input.healthScoreMin !== undefined
        ? gte(companies.healthScore, input.healthScoreMin)
        : undefined,
      input.healthScoreMax !== undefined
        ? lte(companies.healthScore, input.healthScoreMax)
        : undefined,
      input.stageKey ? eq(stage.key, input.stageKey) : undefined,
      input.arrMin !== undefined
        ? gte(companies.ARR, input.arrMin)
        : undefined,
      input.arrMax !== undefined
        ? lte(companies.ARR, input.arrMax)
        : undefined,
      input.ownerEmail
        ? sql`EXISTS (
            SELECT 1 FROM key_role_assignments kra
            JOIN app_user au_kr ON au_kr.id = kra.user_id
            WHERE kra.entity_type = 'company'
              AND kra.entity_id = ${companies.id}
              AND kra.end_at IS NULL
              AND au_kr.email = ${input.ownerEmail}
          )`
        : undefined,
      input.domain ? eq(companies.domain, input.domain) : undefined,
      input.search
        ? fuzzyNameMatch(companies.name, input.search)
        : undefined,
      input.createdAfter
        ? gte(companies.createdAt, new Date(input.createdAfter))
        : undefined,
      input.createdBefore
        ? lte(companies.createdAt, new Date(input.createdBefore + "T23:59:59.999Z"))
        : undefined,
      input.hasNoOwner
        ? sql`NOT EXISTS (
            SELECT 1 FROM key_role_assignments kra
            WHERE kra.entity_type = 'company'
              AND kra.entity_id = ${companies.id}
              AND kra.end_at IS NULL
          )`
        : undefined,
      input.daysSinceLastInteraction
        ? sql`NOT EXISTS (
            SELECT 1 FROM interaction_company ic
            JOIN interactions i ON i.id = ic.interaction_id
            LEFT JOIN meetings m ON m.interaction_id = i.id AND i.kind = 'meeting'
            WHERE ic.company_id = ${companies.id}
              AND i.kind != 'ticket'
              AND (i.kind != 'meeting' OR m.status = 'completed')
              AND i.start_at >= NOW() - INTERVAL '${sql.raw(String(input.daysSinceLastInteraction))} days'
          )`
        : undefined,
      input.daysSinceStageChange
        ? sql`COALESCE(
            (SELECT MAX(eal.created_at) FROM entity_activity_logs eal
             WHERE eal.entity_type = 'company'
               AND eal.entity_id = ${companies.id}
               AND eal.enterprise_id = ${enterpriseId}
               AND eal.action_type = 'stage_changed'),
            ${companies.createdAt}
          ) < NOW() - INTERVAL '${sql.raw(String(input.daysSinceStageChange))} days'`
        : undefined,
      input.healthTrend === "declining"
        ? sql`EXISTS (
            SELECT 1 FROM entity_metric_history emh
            WHERE emh.entity_type = 'company' AND emh.entity_id = ${companies.id}
              AND emh.metric_key = 'health_score' AND emh.enterprise_id = ${enterpriseId}
              AND emh.effective_at >= NOW() - INTERVAL '30 days'
            HAVING MAX(emh.value_number::numeric) - MIN(emh.value_number::numeric) >= 1
              AND (
                SELECT emh2.value_number::numeric FROM entity_metric_history emh2
                WHERE emh2.entity_type = 'company' AND emh2.entity_id = ${companies.id}
                  AND emh2.metric_key = 'health_score' AND emh2.enterprise_id = ${enterpriseId}
                ORDER BY emh2.effective_at DESC LIMIT 1
              ) < (
                SELECT emh3.value_number::numeric FROM entity_metric_history emh3
                WHERE emh3.entity_type = 'company' AND emh3.entity_id = ${companies.id}
                  AND emh3.metric_key = 'health_score' AND emh3.enterprise_id = ${enterpriseId}
                ORDER BY emh3.effective_at ASC LIMIT 1
              )
          )`
        : input.healthTrend === "improving"
          ? sql`EXISTS (
              SELECT 1 FROM entity_metric_history emh
              WHERE emh.entity_type = 'company' AND emh.entity_id = ${companies.id}
                AND emh.metric_key = 'health_score' AND emh.enterprise_id = ${enterpriseId}
                AND emh.effective_at >= NOW() - INTERVAL '30 days'
              HAVING (
                SELECT emh2.value_number::numeric FROM entity_metric_history emh2
                WHERE emh2.entity_type = 'company' AND emh2.entity_id = ${companies.id}
                  AND emh2.metric_key = 'health_score' AND emh2.enterprise_id = ${enterpriseId}
                ORDER BY emh2.effective_at DESC LIMIT 1
              ) > (
                SELECT emh3.value_number::numeric FROM entity_metric_history emh3
                WHERE emh3.entity_type = 'company' AND emh3.entity_id = ${companies.id}
                  AND emh3.metric_key = 'health_score' AND emh3.enterprise_id = ${enterpriseId}
                ORDER BY emh3.effective_at ASC LIMIT 1
              ) + 1
            )`
          : input.healthTrend === "stable"
            ? sql`EXISTS (
                SELECT 1 FROM entity_metric_history emh
                WHERE emh.entity_type = 'company' AND emh.entity_id = ${companies.id}
                  AND emh.metric_key = 'health_score' AND emh.enterprise_id = ${enterpriseId}
                  AND emh.effective_at >= NOW() - INTERVAL '30 days'
                HAVING ABS(
                  (SELECT emh2.value_number::numeric FROM entity_metric_history emh2
                   WHERE emh2.entity_type = 'company' AND emh2.entity_id = ${companies.id}
                     AND emh2.metric_key = 'health_score' AND emh2.enterprise_id = ${enterpriseId}
                   ORDER BY emh2.effective_at DESC LIMIT 1)
                  -
                  (SELECT emh3.value_number::numeric FROM entity_metric_history emh3
                   WHERE emh3.entity_type = 'company' AND emh3.entity_id = ${companies.id}
                     AND emh3.metric_key = 'health_score' AND emh3.enterprise_id = ${enterpriseId}
                   ORDER BY emh3.effective_at ASC LIMIT 1)
                ) < 1
              )`
            : undefined,
      ...customFieldConditions,
    ].filter(Boolean);

    const sortBy = input.sortBy ?? "name";
    const sortOrder = input.sortOrder ?? "asc";
    const limit = input.limit ?? 25;
    const offset = input.offset ?? 0;
    const includeCustomFields = input.includeCustomFields ?? false;

    const sortColumnMap = {
      healthScore: companies.healthScore,
      arr: companies.ARR,
      name: companies.name,
      updatedAt: companies.updatedAt,
      createdAt: companies.createdAt,
    } as const;
    const sortColumn = sortColumnMap[sortBy];
    const orderFn = sortOrder === "desc" ? desc : asc;

    const [rows, [countResult]] = await Promise.all([
      db
        .select({
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          healthScore: companies.healthScore,
          arr: companies.ARR,
          stageName: stage.name,
          stageKey: stage.key,
          updatedAt: companies.updatedAt,
          createdAt: companies.createdAt,
        })
        .from(companies)
        .leftJoin(stage, eq(companies.stageDefinitionId, stage.id))
        .where(and(...conditions))
        .orderBy(orderFn(sortColumn))
        .limit(limit)
        .offset(offset),

      db
        .select({ total: count() })
        .from(companies)
        .leftJoin(stage, eq(companies.stageDefinitionId, stage.id))
        .where(and(...conditions)),
    ]);

    // Fetch key roles for returned companies
    let keyRolesMap: Record<string, Array<{ role: string; roleKey: string; assignee: string; email: string }>> = {};
    if (rows.length > 0) {
      const companyIds = rows.map((r) => r.id);
      const krRows = await db.execute(sql`
        SELECT
          kra.entity_id AS company_id,
          krd.name AS role_name,
          krd.key AS role_key,
          au.name AS user_name,
          au.email AS user_email
        FROM key_role_assignments kra
        JOIN key_role_definitions krd ON krd.id = kra.key_role_definition_id
        JOIN app_user au ON au.id = kra.user_id
        WHERE kra.entity_type = 'company'
          AND kra.entity_id = ANY(${pgUuidArray(companyIds)})
          AND kra.end_at IS NULL
        ORDER BY krd.display_order, krd.name, au.name
      `);

      for (const kr of krRows as any[]) {
        const cid = kr.company_id as string;
        if (!keyRolesMap[cid]) keyRolesMap[cid] = [];
        keyRolesMap[cid].push({
          role: kr.role_name,
          roleKey: kr.role_key,
          assignee: kr.user_name,
          email: kr.user_email,
        });
      }
    }

    // Fetch custom fields for returned companies if requested
    let customFieldsMap: Record<string, Record<string, unknown>> = {};
    if (includeCustomFields && rows.length > 0) {
      const companyIds = rows.map((r) => r.id);
      const cfRows = await db.execute(sql`
        SELECT
          fv.entity_id AS company_id,
          fd.field_key,
          fd.field_name,
          fd.field_type,
          fv.value_text,
          fv.value_number,
          fv.value_date,
          fv.value_bool,
          fv.value_json
        FROM field_values fv
        JOIN field_definitions fd ON fd.id = fv.field_definition_id
        WHERE fv.entity_type IN ('company', 'companies')
          AND fd.entity_type IN ('company', 'companies')
          AND fv.enterprise_id = ${enterpriseId}
          AND fv.entity_id = ANY(${pgUuidArray(companyIds)})
        ORDER BY fd.display_order NULLS LAST, fd.field_name
      `);

      for (const cf of cfRows as any[]) {
        const cid = cf.company_id as string;
        if (!customFieldsMap[cid]) customFieldsMap[cid] = {};
        // Return the appropriate value based on field type
        const value =
          cf.field_type === "number"
            ? cf.value_number != null
              ? Number(cf.value_number)
              : null
            : cf.field_type === "date"
              ? cf.value_date
                ? new Date(cf.value_date).toISOString().slice(0, 10)
                : null
              : cf.field_type === "boolean"
                ? cf.value_bool
                : cf.field_type === "json" || cf.field_type === "multi_enum"
                  ? cf.value_json
                  : cf.value_text;
        customFieldsMap[cid][cf.field_name ?? cf.field_key] = value;
      }
    }

    const total = Number(countResult?.total ?? 0);
    return {
      companies: rows.map((r) => {
        const roles = keyRolesMap[r.id] ?? [];
        const base: Record<string, unknown> = {
          name: r.name,
          domain: r.domain ?? "—",
          healthScore: r.healthScore ?? "N/A",
          arr: r.arr ?? "N/A",
          keyRoles: roles.length > 0
            ? roles.map((kr) => `${kr.role}: ${kr.assignee}`)
            : ["Unassigned"],
          stage: r.stageName ?? "—",
          addedOn: r.createdAt?.toISOString().slice(0, 10) ?? "—",
          lastUpdated: r.updatedAt?.toISOString().slice(0, 10) ?? "—",
        };
        if (includeCustomFields && customFieldsMap[r.id]) {
          base.customFields = customFieldsMap[r.id];
        }
        return base;
      }),
      totalCount: total,
      showing: `${offset + 1}–${Math.min(offset + limit, total)}`,
    };
  },
});
