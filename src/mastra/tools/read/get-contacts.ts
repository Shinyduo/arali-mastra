import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  contacts,
  contactEmails,
  contactPhones,
  customerCompany,
  companies,
} from "../../../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getContacts = createTool({
  id: "get-contacts",
  description:
    "List contacts / leads (people at customer companies). " +
    "Use for 'who are the contacts at Acme?', 'find contact with email john@acme.com', " +
    "'contacts with title VP', 'which new leads came in today?', " +
    "'new contacts this week', or 'contacts added in the last 7 days'.",
  inputSchema: z.object({
    companyName: z
      .string()
      .optional()
      .describe("Filter by associated company name (partial match)"),
    emailSearch: z
      .string()
      .optional()
      .describe("Search by email address (partial match)"),
    nameSearch: z
      .string()
      .optional()
      .describe("Search by contact name (partial match)"),
    titleSearch: z
      .string()
      .optional()
      .describe("Search by job title (partial match)"),
    createdAfter: z
      .string()
      .optional()
      .describe("Only contacts created on or after this date (YYYY-MM-DD). Use for 'new leads today', 'contacts added this week'."),
    createdBefore: z
      .string()
      .optional()
      .describe("Only contacts created on or before this date (YYYY-MM-DD)"),
    sortBy: z
      .enum(["created_at", "name"])
      .optional()
      .default("created_at")
      .describe("Sort by field. Default: created_at (newest first)."),
    limit: z.number().int().min(1).max(50).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    // Use raw SQL for the complex join chain with RBAC
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (ct.id)
        ct.full_name,
        ct.title,
        ce.email AS primary_email,
        cp.phone AS primary_phone,
        c.name AS company_name,
        cc.relation,
        ct.created_at
      FROM contacts ct
      LEFT JOIN contact_emails ce ON ce.contact_id = ct.id AND ce.is_primary = true
      LEFT JOIN contact_phones cp ON cp.contact_id = ct.id AND cp.is_primary = true
      LEFT JOIN customer_company cc ON cc.contact_id = ct.id
      LEFT JOIN companies c ON c.id = cc.company_id
      WHERE ct.enterprise_id = ${enterpriseId}
        ${input.nameSearch ? sql`AND ct.full_name ILIKE ${"%" + input.nameSearch + "%"}` : sql``}
        ${input.titleSearch ? sql`AND ct.title ILIKE ${"%" + input.titleSearch + "%"}` : sql``}
        ${input.emailSearch ? sql`AND ce.email ILIKE ${"%" + input.emailSearch + "%"}` : sql``}
        ${input.companyName ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}` : sql``}
        ${input.createdAfter ? sql`AND ct.created_at >= ${input.createdAfter}::date` : sql``}
        ${input.createdBefore ? sql`AND ct.created_at < (${input.createdBefore}::date + INTERVAL '1 day')` : sql``}
        ${
          !getCompanyScope(capabilities)?.enterprise
            ? sql`AND (
                c.id IS NULL OR
                ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`c.id` as any) ?? sql`TRUE`}
              )`
            : sql``
        }
      ORDER BY ct.id, ${(input.sortBy ?? "created_at") === "name" ? sql`ct.full_name ASC` : sql`ct.created_at DESC`}
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    return {
      contacts: (rows as any[]).map((r: any) => ({
        name: r.full_name ?? "—",
        title: r.title ?? "—",
        email: r.primary_email ?? "—",
        phone: r.primary_phone ?? "—",
        company: r.company_name ?? "—",
        relation: r.relation ?? "—",
        addedOn: r.created_at
          ? new Date(r.created_at).toISOString().slice(0, 10)
          : "—",
      })),
    };
  },
});
