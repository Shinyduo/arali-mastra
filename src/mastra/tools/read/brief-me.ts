import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const briefMe = createTool({
  id: "brief-me",
  description:
    "Pre-call briefing for a company. Returns company overview, recent interactions, open signals, " +
    "overdue action items, and last meeting insights — all in one call. " +
    "Use when the user says 'brief me on Acme', 'prepare me for my call with Company X', " +
    "or 'what should I know before my meeting with [company]?'.",
  inputSchema: z.object({
    companyName: z.string().describe("Company name"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    // Resolve company
    const companyRows = await db.execute(sql`
      SELECT c.id, c.name, c.domain, c.health_score, c.arr, c.currency,
             (SELECT au_kr.name FROM key_role_assignments kra
              JOIN app_user au_kr ON au_kr.id = kra.user_id
              WHERE kra.entity_type = 'company' AND kra.entity_id = c.id AND kra.end_at IS NULL
              ORDER BY kra.created_at ASC LIMIT 1) AS owner_name,
             (SELECT au_kr.email FROM key_role_assignments kra
              JOIN app_user au_kr ON au_kr.id = kra.user_id
              WHERE kra.entity_type = 'company' AND kra.entity_id = c.id AND kra.end_at IS NULL
              ORDER BY kra.created_at ASC LIMIT 1) AS owner_email,
             sd.name AS stage_name
      FROM companies c
      LEFT JOIN stage_definition sd ON sd.id = c.stage_definition_id
      WHERE c.enterprise_id = ${enterpriseId}
        AND ${fuzzyNameMatch(sql`c.name`, input.companyName)}
        ${!getCompanyScope(capabilities)?.enterprise ? sql`AND ${buildKeyRoleScopeClause(getCompanyScope(capabilities), userId, "company", sql`c.id` as any) ?? sql`TRUE`}` : sql``}
      LIMIT 1
    `);

    const company = (companyRows as any[])[0];
    if (!company) return { error: `No company found matching "${input.companyName}".` };

    const companyId = company.id;

    // Run all queries in parallel
    const [signals, actionItems, recentInteractions, keyRoles, healthTrend, lastMeetingInsights] =
      await Promise.all([
        // Open signals
        db.execute(sql`
          SELECT cs.title, cs.type, cs.severity, cs.category_key, cs.last_seen_at
          FROM company_signal cs
          WHERE cs.company_id = ${companyId} AND cs.status = 'open'
          ORDER BY cs.severity DESC, cs.last_seen_at DESC
          LIMIT 10
        `),

        // Overdue + upcoming action items
        db.execute(sql`
          SELECT ai.title, ai.priority, ai.due_at, ps.name AS stage_name, ps.bucket,
                 au.name AS owner_name
          FROM action_item ai
          LEFT JOIN pipeline_stage ps ON ps.id = ai.current_stage_id
          LEFT JOIN app_user au ON au.id = ai.owner_user_id
          JOIN action_item_entity aie ON aie.action_item_id = ai.id
            AND aie.entity_type = 'company' AND aie.entity_id = ${companyId}
          WHERE ai.enterprise_id = ${enterpriseId}
            AND (ps.bucket IS NULL OR ps.bucket NOT IN ('done', 'archived'))
          ORDER BY ai.due_at ASC NULLS LAST
          LIMIT 10
        `),

        // Recent interactions (last 30 days)
        db.execute(sql`
          SELECT i.kind, i.title, i.summary, i.start_at
          FROM interactions i
          JOIN interaction_company ic ON ic.interaction_id = i.id AND ic.company_id = ${companyId}
          WHERE i.start_at >= NOW() - INTERVAL '30 days'
          ORDER BY i.start_at DESC
          LIMIT 10
        `),

        // Key roles
        db.execute(sql`
          SELECT krd.name AS role_name, au.name AS user_name, au.email
          FROM key_role_assignments kra
          JOIN key_role_definitions krd ON krd.id = kra.key_role_definition_id
          JOIN app_user au ON au.id = kra.user_id
          WHERE kra.entity_type = 'company' AND kra.entity_id = ${companyId} AND kra.end_at IS NULL
        `),

        // Health trend (last 14 days)
        db.execute(sql`
          SELECT emh.value_number, emh.effective_at
          FROM entity_metric_history emh
          WHERE emh.enterprise_id = ${enterpriseId}
            AND emh.entity_type = 'company' AND emh.entity_id = ${companyId}
            AND emh.metric_key = 'health_score'
          ORDER BY emh.effective_at DESC
          LIMIT 14
        `),

        // Insights from last meeting
        db.execute(sql`
          SELECT mi.metric_key, mi.details_json, ic_cl.name AS cluster_name
          FROM meeting_insights mi
          LEFT JOIN insight_clusters ic_cl ON ic_cl.id = mi.cluster_id
          WHERE mi.enterprise_id = ${enterpriseId}
            AND mi.meeting_id = (
              SELECT m.id FROM meetings m
              JOIN interactions i ON i.id = m.interaction_id
              JOIN interaction_company ic ON ic.interaction_id = i.id AND ic.company_id = ${companyId}
              ORDER BY i.start_at DESC
              LIMIT 1
            )
          LIMIT 20
        `),
      ]);

    const now = new Date();

    return {
      company: {
        name: company.name,
        domain: company.domain ?? "—",
        healthScore: company.health_score ?? "N/A",
        arr: company.arr ?? "N/A",
        currency: company.currency ?? "USD",
        stage: company.stage_name ?? "—",
        owner: company.owner_name ?? "Unassigned",
      },
      keyRoles: (keyRoles as any[]).map((kr: any) => ({
        role: kr.role_name,
        assignee: kr.user_name,
      })),
      healthTrend: (healthTrend as any[]).map((h: any) => ({
        score: h.value_number != null ? Number(h.value_number) : null,
        date: h.effective_at ? new Date(h.effective_at).toISOString().slice(0, 10) : "—",
      })),
      openSignals: (signals as any[]).map((s: any) => ({
        title: s.title,
        type: s.type,
        severity: s.severity,
        category: s.category_key,
      })),
      actionItems: (actionItems as any[]).map((ai: any) => ({
        title: ai.title,
        priority: ai.priority,
        dueAt: ai.due_at ? new Date(ai.due_at).toISOString().slice(0, 10) : "—",
        isOverdue: ai.due_at ? new Date(ai.due_at) < now : false,
        status: ai.bucket ?? "—",
        owner: ai.owner_name ?? "—",
      })),
      recentInteractions: (recentInteractions as any[]).map((i: any) => ({
        type: i.kind,
        title: i.title,
        summary: i.summary ? (i.summary.length > 200 ? i.summary.slice(0, 200) + "…" : i.summary) : null,
        date: i.start_at ? new Date(i.start_at).toISOString().slice(0, 10) : "—",
      })),
      lastMeetingInsights: (lastMeetingInsights as any[]).map((mi: any) => ({
        type: mi.metric_key,
        cluster: mi.cluster_name ?? null,
        details: mi.details_json,
      })),
    };
  },
});
