import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  companies,
  accounts,
  appUser,
  stageDefinition,
  companySignal,
  keyRoleAssignments,
  keyRoleDefinitions,
  entityMetricHistory,
} from "../../../db/schema.js";
import { eq, and, isNull, desc, sql, count, inArray } from "drizzle-orm";
import { extractContext, buildCompanyScopeFilter, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getCompanyOverview = createTool({
  id: "get-company-overview",
  description:
    "Get a detailed overview of a single company including health score, ARR, stage, owner, " +
    "key role assignments (CSM, AE, etc.), open signals count, accounts, and recent health trend. " +
    "Use this for questions about a specific company like 'tell me about Acme Corp' or 'what's the health of Company X?'.",
  inputSchema: z
    .object({
      companyName: z
        .string()
        .optional()
        .describe("Company name (case-insensitive partial match)"),
      companyId: z.string().uuid().optional().describe("Exact company UUID"),
    })
    .refine((data) => data.companyName || data.companyId, {
      message: "Either companyName or companyId is required",
    }),
  execute: async (input, context) => {
    const { enterpriseId, userId, userRole, orgUnitIds } = extractContext(
      context.requestContext!,
    );

    // Step 1: Resolve the company
    const scopeFilter = buildCompanyScopeFilter(userRole, userId, orgUnitIds);

    const companyConditions = [
      eq(companies.enterpriseId, enterpriseId),
      scopeFilter,
      input.companyId
        ? eq(companies.id, input.companyId)
        : input.companyName
          ? fuzzyNameMatch(companies.name, input.companyName!)
          : undefined,
    ].filter(Boolean);

    const matchedCompanies = await db
      .select({
        id: companies.id,
        name: companies.name,
        domain: companies.domain,
        healthScore: companies.healthScore,
        arr: companies.ARR,
        currency: companies.currency,
        ownerName: appUser.name,
        ownerEmail: appUser.email,
        stageName: stageDefinition.name,
        stageKey: stageDefinition.key,
        createdAt: companies.createdAt,
        updatedAt: companies.updatedAt,
      })
      .from(companies)
      .leftJoin(appUser, eq(companies.ownerUserId, appUser.id))
      .leftJoin(stageDefinition, eq(companies.stageDefinitionId, stageDefinition.id))
      .where(and(...companyConditions))
      .limit(5);

    if (matchedCompanies.length === 0) {
      return {
        error: "No company found matching your query. Check the spelling or try a different name.",
      };
    }

    if (matchedCompanies.length > 1 && !input.companyId) {
      return {
        clarificationNeeded: true,
        message: "Multiple companies match that name. Which one did you mean?",
        matches: matchedCompanies.map((c) => ({
          name: c.name,
          domain: c.domain ?? "—",
          owner: c.ownerName ?? "Unassigned",
        })),
      };
    }

    const company = matchedCompanies[0];

    // Step 2: Fetch related data in parallel
    const [openSignals, keyRoles, healthTrend, companyAccounts, customFields] =
      await Promise.all([
        // Open signals count
        db
          .select({ total: count() })
          .from(companySignal)
          .where(
            and(
              eq(companySignal.companyId, company.id),
              eq(companySignal.status, "open"),
            ),
          ),

        // Key role assignments
        db
          .select({
            roleName: keyRoleDefinitions.name,
            roleKey: keyRoleDefinitions.key,
            userName: appUser.name,
            userEmail: appUser.email,
          })
          .from(keyRoleAssignments)
          .innerJoin(
            keyRoleDefinitions,
            eq(keyRoleAssignments.keyRoleDefinitionId, keyRoleDefinitions.id),
          )
          .innerJoin(appUser, eq(keyRoleAssignments.userId, appUser.id))
          .where(
            and(
              eq(keyRoleAssignments.entityType, "company"),
              eq(keyRoleAssignments.entityId, company.id),
              isNull(keyRoleAssignments.endAt),
            ),
          ),

        // Health trend (last 30 days)
        db
          .select({
            value: entityMetricHistory.valueNumber,
            date: entityMetricHistory.effectiveAt,
          })
          .from(entityMetricHistory)
          .where(
            and(
              eq(entityMetricHistory.enterpriseId, enterpriseId),
              eq(entityMetricHistory.entityType, "company"),
              eq(entityMetricHistory.entityId, company.id),
              eq(entityMetricHistory.metricKey, "health_score"),
            ),
          )
          .orderBy(desc(entityMetricHistory.effectiveAt))
          .limit(30),

        // Accounts under this company
        db
          .select({
            name: accounts.name,
            domain: accounts.domain,
            healthScore: accounts.healthScore,
            arr: accounts.ARR,
          })
          .from(accounts)
          .where(eq(accounts.companyId, company.id)),

        // Custom fields
        db.execute(sql`
          SELECT
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
            AND fv.entity_id = ${company.id}
          ORDER BY fd.display_order NULLS LAST, fd.field_name
        `),
      ]);

    // Transform custom fields into a readable map
    const customFieldsFormatted: Record<string, unknown> = {};
    for (const cf of customFields as any[]) {
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
      customFieldsFormatted[cf.field_name ?? cf.field_key] = value;
    }

    return {
      company: {
        name: company.name,
        domain: company.domain ?? "—",
        healthScore: company.healthScore ?? "N/A",
        arr: company.arr ?? "N/A",
        currency: company.currency ?? "USD",
        stage: company.stageName ?? "—",
        owner: company.ownerName ?? "Unassigned",
        ownerEmail: company.ownerEmail ?? "—",
        createdAt: company.createdAt?.toISOString().slice(0, 10) ?? "—",
      },
      customFields:
        Object.keys(customFieldsFormatted).length > 0
          ? customFieldsFormatted
          : undefined,
      openSignalsCount: openSignals[0]?.total ?? 0,
      keyRoles: keyRoles.map((kr) => ({
        role: kr.roleName,
        assignee: kr.userName,
        email: kr.userEmail,
      })),
      healthTrend: healthTrend.map((h) => ({
        score: h.value ? Number(h.value) : null,
        date: h.date?.toISOString().slice(0, 10) ?? "—",
      })),
      accounts: companyAccounts.map((a) => ({
        name: a.name,
        domain: a.domain ?? "—",
        healthScore: a.healthScore ?? "N/A",
        arr: a.arr ?? "N/A",
      })),
    };
  },
});
