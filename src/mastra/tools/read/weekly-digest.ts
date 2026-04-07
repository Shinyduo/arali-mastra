import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const weeklyDigest = createTool({
  id: "weekly-digest",
  description:
    "Weekly summary: new/worsened signals, health score changes, overdue items, key meetings, " +
    "and accounts with no interactions this week. " +
    "Use for 'weekly digest', 'weekly summary', 'what happened this week?', or 'week in review'.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);

    const weekAgo = new Date(Date.now() - 7 * 86400000);

    const [newSignals, healthChanges, overdueItems, weekMeetings, untouchedAccounts] =
      await Promise.all([
        // Signals opened or updated this week
        db.execute(sql`
          SELECT cs.title, cs.type, cs.severity, cs.category_key,
                 c.name AS company_name, cs.first_seen_at, cs.last_seen_at
          FROM company_signal cs
          JOIN companies c ON c.id = cs.company_id
          WHERE cs.enterprise_id = ${enterpriseId}
            AND cs.status = 'open'
            AND cs.last_seen_at >= ${weekAgo.toISOString()}::timestamptz
          ORDER BY cs.severity DESC, cs.last_seen_at DESC
          LIMIT 20
        `),

        // Companies with health score drops this week
        db.execute(sql`
          WITH latest AS (
            SELECT DISTINCT ON (entity_id)
              entity_id, value_number AS current_score, effective_at
            FROM entity_metric_history
            WHERE enterprise_id = ${enterpriseId}
              AND entity_type = 'company' AND metric_key = 'health_score'
            ORDER BY entity_id, effective_at DESC
          ),
          week_ago AS (
            SELECT DISTINCT ON (entity_id)
              entity_id, value_number AS prev_score
            FROM entity_metric_history
            WHERE enterprise_id = ${enterpriseId}
              AND entity_type = 'company' AND metric_key = 'health_score'
              AND effective_at <= ${weekAgo.toISOString()}::timestamptz
            ORDER BY entity_id, effective_at DESC
          )
          SELECT c.name, l.current_score::numeric, w.prev_score::numeric,
                 (l.current_score::numeric - w.prev_score::numeric) AS change
          FROM latest l
          JOIN week_ago w ON w.entity_id = l.entity_id
          JOIN companies c ON c.id = l.entity_id
          WHERE l.current_score::numeric != w.prev_score::numeric
          ORDER BY change ASC
          LIMIT 15
        `),

        // Overdue action items
        db.execute(sql`
          SELECT ai.title, ai.priority,
                 COALESCE(ai.overdue_at, ai.due_at) AS effective_due,
                 c.name AS company_name, au.name AS owner_name
          FROM action_item ai
          LEFT JOIN pipeline_stage ps ON ps.id = ai.current_stage_id
          LEFT JOIN action_item_entity aie ON aie.action_item_id = ai.id AND aie.entity_type = 'company'
          LEFT JOIN companies c ON c.id = aie.entity_id
          LEFT JOIN app_user au ON au.id = ai.owner_user_id
          WHERE ai.enterprise_id = ${enterpriseId}
            AND COALESCE(ai.overdue_at, ai.due_at) < NOW()
            AND (ps.bucket IS NULL OR ps.bucket NOT IN ('done', 'archived'))
          ORDER BY COALESCE(ai.overdue_at, ai.due_at) ASC
          LIMIT 15
        `),

        // This week's meetings for the user
        db.execute(sql`
          SELECT i.title, i.start_at, c.name AS company_name, i.summary
          FROM interactions i
          JOIN participants p ON p.interaction_id = i.id AND p.user_id = ${userId}
          LEFT JOIN interaction_company ic ON ic.interaction_id = i.id
          LEFT JOIN companies c ON c.id = ic.company_id
          WHERE i.kind = 'meeting'
            AND i.start_at >= ${weekAgo.toISOString()}::timestamptz
          ORDER BY i.start_at DESC
          LIMIT 20
        `),

        // Accounts user owns but hasn't interacted with this week
        db.execute(sql`
          SELECT c.name, c.health_score, c.arr
          FROM companies c
          JOIN key_role_assignments kra ON kra.entity_type = 'company'
            AND kra.entity_id = c.id AND kra.user_id = ${userId} AND kra.end_at IS NULL
          WHERE c.enterprise_id = ${enterpriseId}
            AND NOT EXISTS (
              SELECT 1 FROM interaction_company ic
              JOIN interactions i ON i.id = ic.interaction_id
              WHERE ic.company_id = c.id
                AND i.start_at >= ${weekAgo.toISOString()}::timestamptz
            )
          ORDER BY c.health_score ASC NULLS FIRST
          LIMIT 15
        `),
      ]);

    return {
      signalsThisWeek: (newSignals as any[]).map((s: any) => ({
        title: s.title,
        type: s.type,
        severity: s.severity,
        category: s.category_key,
        company: s.company_name,
      })),
      healthChanges: (healthChanges as any[]).map((h: any) => ({
        company: h.name,
        currentScore: Number(h.current_score),
        previousScore: Number(h.prev_score),
        change: Number(h.change),
      })),
      overdueActionItems: (overdueItems as any[]).map((ai: any) => ({
        title: ai.title,
        priority: ai.priority,
        dueAt: ai.effective_due ? new Date(ai.effective_due).toISOString().slice(0, 10) : "—",
        company: ai.company_name ?? "—",
        owner: ai.owner_name ?? "—",
      })),
      meetingsThisWeek: (weekMeetings as any[]).map((m: any) => ({
        title: m.title,
        date: m.start_at ? new Date(m.start_at).toISOString().slice(0, 10) : "—",
        company: m.company_name ?? "—",
        summary: m.summary ? (m.summary.length > 150 ? m.summary.slice(0, 150) + "…" : m.summary) : null,
      })),
      untouchedAccounts: (untouchedAccounts as any[]).map((a: any) => ({
        company: a.name,
        healthScore: a.health_score ?? "N/A",
        arr: a.arr ?? "N/A",
      })),
    };
  },
});
