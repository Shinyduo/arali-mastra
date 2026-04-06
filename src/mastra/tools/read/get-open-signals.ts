import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companySignal, companies, appUser } from "../../../db/schema.js";
import { eq, and, desc, count } from "drizzle-orm";
import { extractContext, buildCompanyScopeFilter, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getOpenSignals = createTool({
  id: "get-open-signals",
  description:
    "List company signals (risks, opportunities, info alerts). " +
    "Use for 'open risks', 'critical signals', 'what opportunities exist for Company X?'.",
  inputSchema: z.object({
    type: z
      .enum(["risk", "opportunity", "info"])
      .optional()
      .describe("Signal type filter"),
    severity: z
      .enum(["low", "medium", "high", "critical"])
      .optional()
      .describe("Severity filter"),
    status: z
      .enum(["open", "addressed", "resolved", "dismissed", "reopened"])
      .optional()
      .default("open")
      .describe("Status filter"),
    categoryKey: z
      .string()
      .optional()
      .describe("Category key filter (e.g. 'churn', 'expansion_rollout')"),
    companyName: z
      .string()
      .optional()
      .describe("Filter by company name (partial match)"),
    ownerEmail: z
      .string()
      .email()
      .optional()
      .describe("Filter by signal owner email"),
    limit: z.number().int().min(1).max(50).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, userRole, orgUnitIds } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    const status = input.status ?? "open";

    const scopeFilter = buildCompanyScopeFilter(
      userRole,
      userId,
      orgUnitIds,
      companySignal.companyId,
    );

    const conditions = [
      eq(companySignal.enterpriseId, enterpriseId),
      scopeFilter,
      eq(companySignal.status, status),
      input.type ? eq(companySignal.type, input.type) : undefined,
      input.severity
        ? eq(companySignal.severity, input.severity)
        : undefined,
      input.categoryKey
        ? eq(companySignal.categoryKey, input.categoryKey)
        : undefined,
      input.companyName
        ? fuzzyNameMatch(companies.name, input.companyName!)
        : undefined,
      input.ownerEmail ? eq(appUser.email, input.ownerEmail) : undefined,
    ].filter(Boolean);

    const [rows, [countResult]] = await Promise.all([
      db
        .select({
          title: companySignal.title,
          type: companySignal.type,
          severity: companySignal.severity,
          status: companySignal.status,
          categoryKey: companySignal.categoryKey,
          companyName: companies.name,
          ownerName: appUser.name,
          firstSeenAt: companySignal.firstSeenAt,
          lastSeenAt: companySignal.lastSeenAt,
          dueAt: companySignal.dueAt,
        })
        .from(companySignal)
        .innerJoin(companies, eq(companySignal.companyId, companies.id))
        .leftJoin(appUser, eq(companySignal.ownerUserId, appUser.id))
        .where(and(...conditions))
        .orderBy(desc(companySignal.lastSeenAt))
        .limit(limit)
        .offset(offset),

      db
        .select({ total: count() })
        .from(companySignal)
        .innerJoin(companies, eq(companySignal.companyId, companies.id))
        .leftJoin(appUser, eq(companySignal.ownerUserId, appUser.id))
        .where(and(...conditions)),
    ]);

    return {
      signals: rows.map((r) => ({
        title: r.title,
        type: r.type,
        severity: r.severity,
        status: r.status,
        category: r.categoryKey,
        company: r.companyName,
        owner: r.ownerName ?? "Unassigned",
        firstSeen: r.firstSeenAt?.toISOString().slice(0, 10) ?? "—",
        lastSeen: r.lastSeenAt?.toISOString().slice(0, 10) ?? "—",
        dueAt: r.dueAt?.toISOString().slice(0, 10) ?? "—",
      })),
      totalCount: countResult?.total ?? 0,
    };
  },
});
