import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companySignal, companies, appUser } from "../../../db/schema.js";
import { eq, and, lt, gte, lte, desc, count, sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getOpenSignals = createTool({
  id: "get-open-signals",
  description:
    "List company signals (risks, opportunities, info alerts). " +
    "Use for 'open risks', 'critical signals', 'what opportunities exist for Company X?', " +
    "'signals raised this week', 'overdue signals', or 'unassigned risks'.",
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
      .describe("Filter signals where the parent company has this user assigned via key roles"),
    unassigned: z
      .boolean()
      .optional()
      .describe("If true, only show signals for companies with no active key role assignments"),
    overdue: z
      .boolean()
      .optional()
      .describe("If true, only show signals where dueAt is in the past"),
    firstSeenAfter: z
      .string()
      .optional()
      .describe("Only signals first seen on or after this date (YYYY-MM-DD). Use for 'new signals this week'."),
    firstSeenBefore: z
      .string()
      .optional()
      .describe("Only signals first seen on or before this date (YYYY-MM-DD)"),
    limit: z.number().int().min(1).max(50).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    const status = input.status ?? "open";

    const scopeFilter = buildKeyRoleScopeClause(
      getCompanyScope(capabilities),
      userId,
      "company",
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
      input.ownerEmail
        ? sql`EXISTS (
            SELECT 1 FROM key_role_assignments kra
            JOIN app_user au_kr ON au_kr.id = kra.user_id
            WHERE kra.entity_type = 'company'
              AND kra.entity_id = ${companySignal.companyId}
              AND kra.end_at IS NULL
              AND au_kr.email = ${input.ownerEmail}
          )`
        : undefined,
      input.unassigned
        ? sql`NOT EXISTS (
            SELECT 1 FROM key_role_assignments kra
            WHERE kra.entity_type = 'company'
              AND kra.entity_id = ${companySignal.companyId}
              AND kra.end_at IS NULL
          )`
        : undefined,
      input.overdue ? lt(companySignal.dueAt, new Date()) : undefined,
      input.firstSeenAfter
        ? gte(companySignal.firstSeenAt, new Date(input.firstSeenAfter))
        : undefined,
      input.firstSeenBefore
        ? lte(companySignal.firstSeenAt, new Date(input.firstSeenBefore + "T23:59:59.999Z"))
        : undefined,
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
          companyHealth: companies.healthScore,
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

    const now = new Date();
    return {
      signals: rows.map((r) => {
        const isOverdue = r.dueAt ? r.dueAt < now : false;
        const daysOpen = r.firstSeenAt
          ? Math.floor((now.getTime() - r.firstSeenAt.getTime()) / 86400000)
          : null;

        return {
          title: r.title,
          type: r.type,
          severity: r.severity,
          status: r.status,
          category: r.categoryKey,
          company: r.companyName,
          companyHealth: r.companyHealth ?? "N/A",
          owner: r.ownerName ?? "Unassigned",
          firstSeen: r.firstSeenAt?.toISOString().slice(0, 10) ?? "—",
          lastSeen: r.lastSeenAt?.toISOString().slice(0, 10) ?? "—",
          dueAt: r.dueAt?.toISOString().slice(0, 10) ?? "—",
          isOverdue,
          daysOpen,
        };
      }),
      totalCount: countResult?.total ?? 0,
    };
  },
});
