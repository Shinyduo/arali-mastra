import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  billingSubscriptions,
  billingPlans,
  billingInvoice,
  companies,
} from "../../../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { extractContext, buildCompanyScopeFilter, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getBillingOverview = createTool({
  id: "get-billing-overview",
  description:
    "Get billing and subscription details for a company: active plan, MRR, contract value, " +
    "upcoming renewal, and recent invoices. " +
    "Use for 'what plan is Acme on?', 'MRR for Company X', or 'open invoices for this account'.",
  inputSchema: z.object({
    companyName: z
      .string()
      .optional()
      .describe("Company name (partial match)"),
    companyId: z.string().uuid().optional().describe("Exact company UUID"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, userRole, orgUnitIds } = extractContext(
      context.requestContext!,
    );

    if (!input.companyName && !input.companyId) {
      return { error: "Either companyName or companyId is required" };
    }

    // Resolve company first
    const scopeFilter = buildCompanyScopeFilter(userRole, userId, orgUnitIds);
    const companyConditions = [
      eq(companies.enterpriseId, enterpriseId),
      scopeFilter,
      input.companyId
        ? eq(companies.id, input.companyId)
        : fuzzyNameMatch(companies.name, input.companyName!),
    ].filter(Boolean);

    const matched = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(...companyConditions))
      .limit(3);

    if (matched.length === 0) {
      return { error: "No company found matching your query." };
    }
    if (matched.length > 1 && !input.companyId) {
      return {
        clarificationNeeded: true,
        message: "Multiple companies match. Which one?",
        matches: matched.map((c) => c.name),
      };
    }

    const company = matched[0];

    // Fetch subscriptions and invoices in parallel
    const [subscriptions, invoices] = await Promise.all([
      db
        .select({
          planName: billingPlans.name,
          planKey: billingPlans.key,
          status: billingSubscriptions.status,
          currency: billingSubscriptions.currency,
          billingInterval: billingSubscriptions.billingInterval,
          contractValueCents: billingSubscriptions.contractValueCents,
          mrrCents: billingSubscriptions.mrrCents,
          startAt: billingSubscriptions.startAt,
          currentPeriodEndAt: billingSubscriptions.currentPeriodEndAt,
          cancelAt: billingSubscriptions.cancelAt,
        })
        .from(billingSubscriptions)
        .innerJoin(
          billingPlans,
          eq(billingSubscriptions.planId, billingPlans.id),
        )
        .where(
          and(
            eq(billingSubscriptions.companyId, company.id),
            eq(billingSubscriptions.enterpriseId, enterpriseId),
          ),
        )
        .orderBy(desc(billingSubscriptions.startAt)),

      db
        .select({
          status: billingInvoice.status,
          currency: billingInvoice.currency,
          amountDueCents: billingInvoice.amountDueCents,
          amountPaidCents: billingInvoice.amountPaidCents,
          issuedAt: billingInvoice.issuedAt,
          dueAt: billingInvoice.dueAt,
          paidAt: billingInvoice.paidAt,
        })
        .from(billingInvoice)
        .where(
          and(
            eq(billingInvoice.companyId, company.id),
            eq(billingInvoice.enterpriseId, enterpriseId),
          ),
        )
        .orderBy(desc(billingInvoice.issuedAt))
        .limit(10),
    ]);

    const formatCents = (cents: number | null, currency: string) => {
      if (cents == null) return "—";
      return `${currency} ${(cents / 100).toLocaleString("en", { minimumFractionDigits: 2 })}`;
    };

    return {
      company: company.name,
      subscriptions: subscriptions.map((s) => ({
        plan: s.planName,
        status: s.status,
        billingInterval: s.billingInterval,
        contractValue: formatCents(s.contractValueCents, s.currency),
        mrr: formatCents(s.mrrCents, s.currency),
        startDate: s.startAt?.toISOString().slice(0, 10) ?? "—",
        renewalDate: s.currentPeriodEndAt?.toISOString().slice(0, 10) ?? "—",
        cancelDate: s.cancelAt?.toISOString().slice(0, 10) ?? null,
      })),
      recentInvoices: invoices.map((inv) => ({
        status: inv.status,
        amountDue: formatCents(inv.amountDueCents, inv.currency),
        amountPaid: formatCents(inv.amountPaidCents, inv.currency),
        issuedAt: inv.issuedAt?.toISOString().slice(0, 10) ?? "—",
        dueAt: inv.dueAt?.toISOString().slice(0, 10) ?? "—",
        paidAt: inv.paidAt?.toISOString().slice(0, 10) ?? null,
      })),
    };
  },
});
