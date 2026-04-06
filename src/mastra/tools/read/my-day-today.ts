import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const myDayToday = createTool({
  id: "my-day-today",
  description:
    "Get everything the user needs to know for today: today's meetings, overdue action items, " +
    "new signals since yesterday, and upcoming due dates. " +
    "Use when the user says 'what's on my plate today?', 'my day', 'what do I have today?', " +
    "or 'daily briefing'.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const yesterday = new Date(todayStart.getTime() - 86400000);

    const [todayMeetings, overdueItems, upcomingItems, newSignals] =
      await Promise.all([
        // Today's meetings where user is a participant
        db.execute(sql`
          SELECT i.title, i.start_at, i.end_at, c.name AS company_name
          FROM interactions i
          JOIN participants p ON p.interaction_id = i.id AND p.user_id = ${userId}
          LEFT JOIN interaction_company ic ON ic.interaction_id = i.id
          LEFT JOIN companies c ON c.id = ic.company_id
          WHERE i.kind = 'meeting'
            AND i.start_at >= ${todayStart.toISOString()}::timestamptz
            AND i.start_at <= ${todayEnd.toISOString()}::timestamptz
          ORDER BY i.start_at ASC
        `),

        // Overdue action items owned by user
        db.execute(sql`
          SELECT ai.title, ai.priority, ai.due_at, ps.name AS stage_name,
                 c.name AS company_name
          FROM action_item ai
          LEFT JOIN pipeline_stage ps ON ps.id = ai.current_stage_id
          LEFT JOIN action_item_entity aie ON aie.action_item_id = ai.id AND aie.entity_type = 'company'
          LEFT JOIN companies c ON c.id = aie.entity_id
          WHERE ai.enterprise_id = ${enterpriseId}
            AND ai.owner_user_id = ${userId}
            AND ai.due_at < NOW()
            AND (ps.bucket IS NULL OR ps.bucket NOT IN ('done', 'archived'))
          ORDER BY ai.due_at ASC
          LIMIT 15
        `),

        // Action items due today or this week
        db.execute(sql`
          SELECT ai.title, ai.priority, ai.due_at, ps.name AS stage_name,
                 c.name AS company_name
          FROM action_item ai
          LEFT JOIN pipeline_stage ps ON ps.id = ai.current_stage_id
          LEFT JOIN action_item_entity aie ON aie.action_item_id = ai.id AND aie.entity_type = 'company'
          LEFT JOIN companies c ON c.id = aie.entity_id
          WHERE ai.enterprise_id = ${enterpriseId}
            AND ai.owner_user_id = ${userId}
            AND ai.due_at >= NOW()
            AND ai.due_at <= NOW() + INTERVAL '7 days'
            AND (ps.bucket IS NULL OR ps.bucket NOT IN ('done', 'archived'))
          ORDER BY ai.due_at ASC
          LIMIT 10
        `),

        // New signals since yesterday
        db.execute(sql`
          SELECT cs.title, cs.type, cs.severity, cs.category_key,
                 c.name AS company_name
          FROM company_signal cs
          JOIN companies c ON c.id = cs.company_id
          WHERE cs.enterprise_id = ${enterpriseId}
            AND cs.status = 'open'
            AND cs.last_seen_at >= ${yesterday.toISOString()}::timestamptz
            AND (cs.owner_user_id = ${userId} OR cs.owner_user_id IS NULL)
          ORDER BY cs.severity DESC, cs.last_seen_at DESC
          LIMIT 15
        `),
      ]);

    return {
      todaysMeetings: (todayMeetings as any[]).map((m: any) => ({
        title: m.title,
        time: m.start_at ? new Date(m.start_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—",
        endTime: m.end_at ? new Date(m.end_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null,
        company: m.company_name ?? "—",
      })),
      overdueActionItems: (overdueItems as any[]).map((ai: any) => ({
        title: ai.title,
        priority: ai.priority,
        dueAt: ai.due_at ? new Date(ai.due_at).toISOString().slice(0, 10) : "—",
        status: ai.stage_name ?? "—",
        company: ai.company_name ?? "—",
      })),
      upcomingThisWeek: (upcomingItems as any[]).map((ai: any) => ({
        title: ai.title,
        priority: ai.priority,
        dueAt: ai.due_at ? new Date(ai.due_at).toISOString().slice(0, 10) : "—",
        company: ai.company_name ?? "—",
      })),
      newSignalsSinceYesterday: (newSignals as any[]).map((s: any) => ({
        title: s.title,
        type: s.type,
        severity: s.severity,
        category: s.category_key,
        company: s.company_name,
      })),
    };
  },
});
