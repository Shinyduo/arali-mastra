import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  contacts,
  contactEmails,
  contactPhones,
  customerCompany,
  companies,
  stageDefinition,
} from "../../../db/schema.js";
import { eq, and, gte, lte, asc, desc, sql, count } from "drizzle-orm";
import {
  extractContext,
  getCompanyScope,
  buildContactScopeClause,
  fuzzyNameMatch,
  pgUuidArray,
} from "../../../lib/rbac.js";

export const getContacts = createTool({
  id: "get-contacts",
  description:
    "List contacts / leads (people at customer companies). Supports filters for stage, owner (via key roles), " +
    "creation date, inactivity, stage duration, and custom field values. Contacts may have enterprise-defined custom " +
    "fields (e.g. 'region', 'lead_source'). Use customFieldFilters to filter by them, and set includeCustomFields=true " +
    "to return their values. " +
    "Use for: 'who are the contacts at Acme?', 'find contact with email john@acme.com', 'contacts with title VP', " +
    "'new leads this week', 'contacts with no owner', 'contacts untouched in 30 days', " +
    "'contacts where region is APAC', or 'contacts stuck in qualified stage for 5 days'.",
  inputSchema: z.object({
    companyName: z
      .string()
      .optional()
      .describe("Filter by associated company name (fuzzy partial match)"),
    emailSearch: z
      .string()
      .optional()
      .describe("Search by email address (case-insensitive partial match)"),
    nameSearch: z.string().optional().describe("Search by contact name (fuzzy partial match)"),
    titleSearch: z.string().optional().describe("Search by job title (case-insensitive partial match)"),
    stageKey: z
      .string()
      .optional()
      .describe("Filter by contact stage key (e.g. 'new_lead', 'qualified', 'customer')"),
    ownerEmail: z
      .string()
      .email()
      .optional()
      .describe(
        "Filter by assigned user's email (via key role assignments). Use for 'my contacts' or 'contacts assigned to X'.",
      ),
    hasNoOwner: z
      .boolean()
      .optional()
      .describe(
        "If true, only show contacts with no active key role assignments. Use for 'unassigned contacts'.",
      ),
    daysSinceLastInteraction: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Only contacts with no interactions in the last N days (via participants table). " +
          "Use for 'untouched contacts', 'contacts not contacted in 30 days'.",
      ),
    daysSinceStageChange: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Only contacts whose stage has not changed in the last N days (stuck in current stage). " +
          "Use with stageKey to find 'contacts stuck in qualified for 5 days'.",
      ),
    createdAfter: z
      .string()
      .optional()
      .describe("Only contacts created on or after this date (YYYY-MM-DD)"),
    createdBefore: z
      .string()
      .optional()
      .describe("Only contacts created on or before this date (YYYY-MM-DD)"),
    customFieldFilters: z
      .array(
        z.object({
          fieldKey: z.string().describe("Custom field key"),
          operator: z
            .enum(["is", "is_not", "contains", "gt", "lt", "gte", "lte", "is_empty", "not_empty"])
            .describe("Comparison operator"),
          value: z.string().optional().describe("Value to compare against"),
        }),
      )
      .optional()
      .describe("Filter by custom field values"),
    includeCustomFields: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, include custom field values in the response"),
    sortBy: z
      .enum(["createdAt", "updatedAt", "name"])
      .optional()
      .default("createdAt")
      .describe("Sort field"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort direction"),
    limit: z.number().int().min(1).max(100).optional().default(25),
    offset: z.number().int().min(0).optional().default(0),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(context.requestContext!);

    // Contacts use the "meeting.read" capability's scope (same resource gate as companies)
    const scopeFilter = buildContactScopeClause(
      getCompanyScope(capabilities),
      userId,
      contacts.id,
    );

    // Custom field filters — EXISTS subqueries against field_values joined to field_definitions
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
            WHERE fv_cf.entity_type IN ('contact', 'contacts')
              AND fv_cf.entity_id = ${contacts.id}
              AND fd_cf.field_key = ${f.fieldKey}
              AND fd_cf.enterprise_id = ${enterpriseId}
          )`;
        case "not_empty":
          return sql`EXISTS (
            SELECT 1 FROM field_values fv_cf
            JOIN field_definitions fd_cf ON fd_cf.id = fv_cf.field_definition_id
            WHERE fv_cf.entity_type IN ('contact', 'contacts')
              AND fv_cf.entity_id = ${contacts.id}
              AND fd_cf.field_key = ${f.fieldKey}
              AND fd_cf.enterprise_id = ${enterpriseId}
          )`;
        default:
          comparison = sql`${valueCol} = ${f.value}`;
      }

      return sql`EXISTS (
        SELECT 1 FROM field_values fv_cf
        JOIN field_definitions fd_cf ON fd_cf.id = fv_cf.field_definition_id
        WHERE fv_cf.entity_type IN ('contact', 'contacts')
          AND fv_cf.entity_id = ${contacts.id}
          AND fd_cf.field_key = ${f.fieldKey}
          AND fd_cf.enterprise_id = ${enterpriseId}
          AND ${comparison}
      )`;
    });

    const conditions = [
      eq(contacts.enterpriseId, enterpriseId),
      scopeFilter,
      input.nameSearch ? fuzzyNameMatch(contacts.fullName, input.nameSearch) : undefined,
      input.titleSearch
        ? sql`${contacts.title} ILIKE ${"%" + input.titleSearch + "%"}`
        : undefined,
      input.emailSearch
        ? sql`EXISTS (
            SELECT 1 FROM contact_emails ce_f
            WHERE ce_f.contact_id = ${contacts.id}
              AND ce_f.email ILIKE ${"%" + input.emailSearch + "%"}
          )`
        : undefined,
      input.companyName
        ? sql`EXISTS (
            SELECT 1 FROM customer_company cc_f
            JOIN companies c_f ON c_f.id = cc_f.company_id
            WHERE cc_f.contact_id = ${contacts.id}
              AND ${fuzzyNameMatch(sql`c_f.name`, input.companyName)}
          )`
        : undefined,
      input.stageKey ? eq(stageDefinition.key, input.stageKey) : undefined,
      input.createdAfter ? gte(contacts.createdAt, new Date(input.createdAfter)) : undefined,
      input.createdBefore
        ? lte(contacts.createdAt, new Date(input.createdBefore + "T23:59:59.999Z"))
        : undefined,
      input.ownerEmail
        ? sql`EXISTS (
            SELECT 1 FROM key_role_assignments kra
            JOIN app_user au_kr ON au_kr.id = kra.user_id
            WHERE kra.entity_type IN ('contact', 'contacts')
              AND kra.entity_id = ${contacts.id}
              AND (kra.end_at IS NULL OR kra.end_at > NOW())
              AND au_kr.email = ${input.ownerEmail}
          )`
        : undefined,
      input.hasNoOwner
        ? sql`NOT EXISTS (
            SELECT 1 FROM key_role_assignments kra
            WHERE kra.entity_type IN ('contact', 'contacts')
              AND kra.entity_id = ${contacts.id}
              AND (kra.end_at IS NULL OR kra.end_at > NOW())
          )`
        : undefined,
      input.daysSinceLastInteraction
        ? sql`NOT EXISTS (
            SELECT 1 FROM participants p
            JOIN interactions i ON i.id = p.interaction_id
            WHERE p.contact_id = ${contacts.id}
              AND i.start_at >= NOW() - INTERVAL '${sql.raw(String(input.daysSinceLastInteraction))} days'
          )`
        : undefined,
      input.daysSinceStageChange
        ? sql`COALESCE(
            (SELECT MAX(eal.created_at) FROM entity_activity_logs eal
             WHERE eal.entity_type = 'contact'
               AND eal.entity_id = ${contacts.id}
               AND eal.enterprise_id = ${enterpriseId}
               AND eal.action_type = 'stage_changed'),
            ${contacts.createdAt}
          ) < NOW() - INTERVAL '${sql.raw(String(input.daysSinceStageChange))} days'`
        : undefined,
      ...customFieldConditions,
    ].filter(Boolean);

    const sortBy = input.sortBy ?? "createdAt";
    const sortOrder = input.sortOrder ?? "desc";
    const limit = input.limit ?? 25;
    const offset = input.offset ?? 0;
    const includeCustomFields = input.includeCustomFields ?? false;

    const sortColumnMap = {
      name: contacts.fullName,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
    } as const;
    const sortColumn = sortColumnMap[sortBy];
    const orderFn = sortOrder === "desc" ? desc : asc;

    const [rows, [countResult]] = await Promise.all([
      db
        .select({
          id: contacts.id,
          fullName: contacts.fullName,
          title: contacts.title,
          createdAt: contacts.createdAt,
          updatedAt: contacts.updatedAt,
          stageName: stageDefinition.name,
          stageKey: stageDefinition.key,
          email: contactEmails.email,
          phone: contactPhones.phone,
          companyName: companies.name,
          relation: customerCompany.relation,
        })
        .from(contacts)
        .leftJoin(stageDefinition, eq(contacts.stageDefinitionId, stageDefinition.id))
        .leftJoin(
          contactEmails,
          and(eq(contactEmails.contactId, contacts.id), eq(contactEmails.isPrimary, true)),
        )
        .leftJoin(
          contactPhones,
          and(eq(contactPhones.contactId, contacts.id), eq(contactPhones.isPrimary, true)),
        )
        .leftJoin(
          customerCompany,
          and(eq(customerCompany.contactId, contacts.id), eq(customerCompany.isPrimary, true)),
        )
        .leftJoin(companies, eq(companies.id, customerCompany.companyId))
        .where(and(...conditions))
        .orderBy(orderFn(sortColumn))
        .limit(limit)
        .offset(offset),

      db
        .select({ total: count() })
        .from(contacts)
        .leftJoin(stageDefinition, eq(contacts.stageDefinitionId, stageDefinition.id))
        .where(and(...conditions)),
    ]);

    // Fetch key roles for returned contacts
    const keyRolesMap: Record<
      string,
      Array<{ role: string; roleKey: string; assignee: string; email: string }>
    > = {};
    if (rows.length > 0) {
      const contactIds = rows.map((r) => r.id);
      const krRows = await db.execute(sql`
        SELECT
          kra.entity_id AS contact_id,
          krd.name AS role_name,
          krd.key AS role_key,
          au.name AS user_name,
          au.email AS user_email
        FROM key_role_assignments kra
        JOIN key_role_definitions krd ON krd.id = kra.key_role_definition_id
        JOIN app_user au ON au.id = kra.user_id
        WHERE kra.entity_type IN ('contact', 'contacts')
          AND kra.entity_id = ANY(${pgUuidArray(contactIds)})
          AND (kra.end_at IS NULL OR kra.end_at > NOW())
        ORDER BY krd.display_order, krd.name, au.name
      `);

      for (const kr of krRows as any[]) {
        const cid = kr.contact_id as string;
        if (!keyRolesMap[cid]) keyRolesMap[cid] = [];
        keyRolesMap[cid].push({
          role: kr.role_name,
          roleKey: kr.role_key,
          assignee: kr.user_name,
          email: kr.user_email,
        });
      }
    }

    // Fetch custom fields if requested
    const customFieldsMap: Record<string, Record<string, unknown>> = {};
    if (includeCustomFields && rows.length > 0) {
      const contactIds = rows.map((r) => r.id);
      const cfRows = await db.execute(sql`
        SELECT
          fv.entity_id AS contact_id,
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
        WHERE fv.entity_type IN ('contact', 'contacts')
          AND fd.entity_type IN ('contact', 'contacts')
          AND fv.enterprise_id = ${enterpriseId}
          AND fv.entity_id = ANY(${pgUuidArray(contactIds)})
        ORDER BY fd.display_order NULLS LAST, fd.field_name
      `);

      for (const cf of cfRows as any[]) {
        const cid = cf.contact_id as string;
        if (!customFieldsMap[cid]) customFieldsMap[cid] = {};
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
      contacts: rows.map((r) => {
        const roles = keyRolesMap[r.id] ?? [];
        const base: Record<string, unknown> = {
          name: r.fullName ?? "—",
          title: r.title ?? "—",
          email: r.email ?? "—",
          phone: r.phone ?? "—",
          company: r.companyName ?? "—",
          relation: r.relation ?? "—",
          stage: r.stageName ?? "—",
          keyRoles:
            roles.length > 0 ? roles.map((kr) => `${kr.role}: ${kr.assignee}`) : ["Unassigned"],
          addedOn: r.createdAt?.toISOString().slice(0, 10) ?? "—",
          lastUpdated: r.updatedAt?.toISOString().slice(0, 10) ?? "—",
        };
        if (includeCustomFields && customFieldsMap[r.id]) {
          base.customFields = customFieldsMap[r.id];
        }
        return base;
      }),
      totalCount: total,
      showing: total > 0 ? `${offset + 1}–${Math.min(offset + limit, total)}` : "0",
    };
  },
});
