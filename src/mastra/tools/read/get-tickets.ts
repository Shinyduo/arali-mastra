import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  tickets,
  interactions,
  interactionCompany,
  companies,
} from "../../../db/schema.js";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getTickets = createTool({
  id: "get-tickets",
  description:
    "List support tickets with status, subject, and resolution times. " +
    "Use for 'open tickets for Acme', 'resolved tickets this month', " +
    "'tickets raised this week', or 'average resolution time'.",
  inputSchema: z.object({
    status: z
      .enum(["open", "pending", "resolved", "closed", "archived"])
      .optional()
      .describe("Filter by ticket status"),
    companyName: z
      .string()
      .optional()
      .describe("Filter by associated company name"),
    startDate: z
      .string()
      .optional()
      .describe("Filter tickets created on or after this date (YYYY-MM-DD)"),
    endDate: z
      .string()
      .optional()
      .describe("Filter tickets created on or before this date (YYYY-MM-DD). End-of-day inclusive."),
    limit: z.number().int().min(1).max(50).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    const scopeFilter = buildKeyRoleScopeClause(
      getCompanyScope(capabilities),
      userId,
      "company",
      interactionCompany.companyId,
    );

    const conditions = [
      eq(tickets.enterpriseId, enterpriseId),
      scopeFilter,
      input.status ? eq(tickets.status, input.status) : undefined,
      input.companyName
        ? fuzzyNameMatch(companies.name, input.companyName!)
        : undefined,
      input.startDate
        ? gte(tickets.createdAt, new Date(input.startDate))
        : undefined,
      input.endDate
        ? lte(tickets.createdAt, new Date(input.endDate + "T23:59:59.999Z"))
        : undefined,
    ].filter(Boolean);

    const [rows, [countResult]] = await Promise.all([
      db
        .select({
          subject: tickets.subject,
          status: tickets.status,
          issueRaisedAt: tickets.issueRaisedAt,
          firstResponseAt: tickets.firstResponseAt,
          issueResolvedAt: tickets.issueResolvedAt,
          companyName: companies.name,
          providerKey: tickets.providerKey,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .innerJoin(
          interactionCompany,
          eq(tickets.interactionId, interactionCompany.interactionId),
        )
        .innerJoin(companies, eq(interactionCompany.companyId, companies.id))
        .where(and(...conditions))
        .orderBy(desc(tickets.createdAt))
        .limit(limit)
        .offset(offset),

      db
        .select({ total: count() })
        .from(tickets)
        .innerJoin(
          interactionCompany,
          eq(tickets.interactionId, interactionCompany.interactionId),
        )
        .innerJoin(companies, eq(interactionCompany.companyId, companies.id))
        .where(and(...conditions)),
    ]);

    return {
      tickets: rows.map((r) => {
        const firstResponseMs =
          r.firstResponseAt && r.issueRaisedAt
            ? r.firstResponseAt.getTime() - r.issueRaisedAt.getTime()
            : null;
        const resolutionMs =
          r.issueResolvedAt && r.issueRaisedAt
            ? r.issueResolvedAt.getTime() - r.issueRaisedAt.getTime()
            : null;

        return {
          subject: r.subject ?? "—",
          status: r.status,
          company: r.companyName,
          provider: r.providerKey,
          raisedAt: r.issueRaisedAt?.toISOString().slice(0, 10) ?? "—",
          createdAt: r.createdAt?.toISOString().slice(0, 10) ?? "—",
          firstResponseHours: firstResponseMs
            ? Math.round(firstResponseMs / 3600000)
            : null,
          resolutionHours: resolutionMs
            ? Math.round(resolutionMs / 3600000)
            : null,
        };
      }),
      totalCount: countResult?.total ?? 0,
    };
  },
});
