import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, pgUuidArray } from "../../../lib/rbac.js";
import { getScopeForResource } from "../../../lib/resolve-user-role.js";

const SORT_COLUMNS = [
  "name",
  "total_companies",
  "total_accounts",
  "total_arr",
  "total_calls",
  "meetings_hosted",
  "total_threads",
  "interactions_in_window",
  "open_signals",
  "critical_signals",
  "open_tasks",
  "overdue_tasks",
] as const;

export const getTeamPortfolio = createTool({
  id: "get-team-portfolio",
  description:
    "Get rep/team member performance metrics — companies, ARR, calls, meetings, threads, signals, tasks, and key roles. " +
    "Use for: 'show team performance', 'who has the most ARR?', 'which rep has the most open signals?', " +
    "'how many CSMs do I have?', 'show team workload', 'compare rep activity', 'who are my AEs?'. " +
    "Returns per-rep metrics matching the Rep page.",
  inputSchema: z.object({
    search: z
      .string()
      .optional()
      .describe("Filter reps by name or email (partial match)"),
    roleKey: z
      .string()
      .optional()
      .describe(
        "Only show reps with this role key assigned (e.g. 'csm', 'ae', 'tam')",
      ),
    fromDate: z
      .string()
      .optional()
      .describe(
        "Start of date window for activity metrics (ISO date, default: 90 days ago)",
      ),
    toDate: z
      .string()
      .optional()
      .describe(
        "End of date window for activity metrics (ISO date, default: today)",
      ),
    sortBy: z
      .enum(SORT_COLUMNS)
      .optional()
      .default("total_arr")
      .describe("Sort reps by this metric (descending, except name=ascending)"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Maximum reps to return (default 20, max 50)"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    // Date window defaults to last 90 days
    const now = new Date();
    const defaultFrom = new Date(
      now.getTime() - 90 * 24 * 60 * 60 * 1000,
    );
    const fromDate = input.fromDate
      ? new Date(input.fromDate).toISOString()
      : defaultFrom.toISOString();
    const toDate = input.toDate
      ? new Date(input.toDate).toISOString()
      : now.toISOString();
    const limit = Math.min(input.limit ?? 20, 50);
    const sortBy = input.sortBy ?? "total_arr";

    // RBAC: determine which reps the current user can see (user.read scope)
    const userScope = getScopeForResource(capabilities, "user", "read");

    if (!userScope) {
      return { reps: [], summary: { totalReps: 0 }, dateWindow: { from: fromDate, to: toDate } };
    }

    let userFilter;
    if (userScope.enterprise) {
      userFilter = sql`TRUE`;
    } else if (userScope.orgUnits.length > 0 && userScope.self) {
      userFilter = sql`(
        EXISTS (
          SELECT 1 FROM user_org_unit uou
          WHERE uou.user_id = u.id
            AND uou.enterprise_id = ${enterpriseId}
            AND uou.org_unit_id = ANY(${pgUuidArray(userScope.orgUnits)})
        )
        OR u.id = ${userId}
      )`;
    } else if (userScope.orgUnits.length > 0) {
      userFilter = sql`EXISTS (
        SELECT 1 FROM user_org_unit uou
        WHERE uou.user_id = u.id
          AND uou.enterprise_id = ${enterpriseId}
          AND uou.org_unit_id = ANY(${pgUuidArray(userScope.orgUnits)})
      )`;
    } else if (userScope.self) {
      userFilter = sql`u.id = ${userId}`;
    } else {
      return { reps: [], summary: { totalReps: 0 }, dateWindow: { from: fromDate, to: toDate } };
    }

    const searchFilter = input.search
      ? sql`AND (u.name ILIKE ${"%" + input.search + "%"} OR u.email ILIKE ${"%" + input.search + "%"})`
      : sql``;

    const roleFilter = input.roleKey
      ? sql`AND u.id IN (
          SELECT kra_rf.user_id FROM key_role_assignments kra_rf
          JOIN key_role_definitions krd_rf ON krd_rf.id = kra_rf.key_role_definition_id
          WHERE kra_rf.enterprise_id = ${enterpriseId}
            AND krd_rf.key = ${input.roleKey}
            AND (kra_rf.end_at IS NULL OR kra_rf.end_at > NOW())
        )`
      : sql``;

    const orderClause =
      sortBy === "name"
        ? sql`ORDER BY u.name ASC NULLS LAST`
        : sql`ORDER BY ${sql.raw(sortBy)} DESC NULLS LAST, u.name ASC NULLS LAST`;

    const rows = await db.execute(sql`
      WITH company_role_assignments AS (
        SELECT DISTINCT kra.user_id, kra.entity_id AS company_id
        FROM key_role_assignments kra
        WHERE kra.enterprise_id = ${enterpriseId}
          AND kra.entity_type = 'company'
          AND (kra.end_at IS NULL OR kra.end_at > NOW())
          AND kra.id = (
            SELECT kra2.id FROM key_role_assignments kra2
            WHERE kra2.entity_id = kra.entity_id
              AND kra2.entity_type = kra.entity_type
              AND kra2.key_role_definition_id = kra.key_role_definition_id
              AND kra2.enterprise_id = kra.enterprise_id
              AND (kra2.end_at IS NULL OR kra2.end_at > NOW())
            ORDER BY kra2.start_at DESC
            LIMIT 1
          )
      ),

      assigned_companies AS (
        SELECT DISTINCT user_id, company_id FROM company_role_assignments
      ),

      assigned_accounts AS (
        SELECT DISTINCT kra.user_id, kra.entity_id AS account_id
        FROM key_role_assignments kra
        WHERE kra.enterprise_id = ${enterpriseId}
          AND kra.entity_type = 'account'
          AND (kra.end_at IS NULL OR kra.end_at > NOW())
      ),

      company_agg AS (
        SELECT
          ac.user_id,
          COUNT(DISTINCT c.id) AS total_companies,
          COALESCE(SUM(
            CASE
              WHEN UPPER(c.currency) = 'USD' OR c.currency IS NULL THEN COALESCE(c.arr, 0)
              WHEN er_d.rate IS NOT NULL THEN ROUND(COALESCE(c.arr, 0) * er_d.rate::numeric)
              WHEN er_i.rate IS NOT NULL THEN ROUND(COALESCE(c.arr, 0) / NULLIF(er_i.rate::numeric, 0))
              ELSE COALESCE(c.arr, 0)
            END
          ), 0) AS total_arr,
          ROUND((AVG(c.health_score) / 10.0)::numeric, 2) AS avg_health_score
        FROM assigned_companies ac
        INNER JOIN companies c
          ON c.id = ac.company_id AND c.enterprise_id = ${enterpriseId}
        LEFT JOIN stage_definition sd ON sd.id = c.stage_definition_id
        LEFT JOIN LATERAL (
          SELECT rate FROM exchange_rate
          WHERE from_currency = UPPER(c.currency) AND to_currency = 'USD'
          ORDER BY date DESC LIMIT 1
        ) er_d ON TRUE
        LEFT JOIN LATERAL (
          SELECT rate FROM exchange_rate
          WHERE from_currency = 'USD' AND to_currency = UPPER(c.currency)
          ORDER BY date DESC LIMIT 1
        ) er_i ON TRUE
        WHERE COALESCE(sd.bucket, 'live') <> 'churned'
        GROUP BY ac.user_id
      ),

      accounts_agg AS (
        SELECT user_id, COUNT(*) AS total_accounts
        FROM assigned_accounts
        GROUP BY user_id
      ),

      calls_agg AS (
        SELECT
          pt.user_id,
          COUNT(DISTINCT c.id) FILTER (WHERE c.direction = 'outbound') AS outbound_calls,
          COUNT(DISTINCT c.id) FILTER (WHERE c.direction = 'inbound') AS inbound_calls
        FROM calls c
        INNER JOIN participants pt ON pt.interaction_id = c.interaction_id
        INNER JOIN interactions i ON i.id = c.interaction_id
        WHERE c.enterprise_id = ${enterpriseId}
          AND pt.user_id IS NOT NULL
          AND i.start_at >= ${fromDate}::timestamptz
          AND i.start_at < ${toDate}::timestamptz
        GROUP BY pt.user_id
      ),

      meetings_agg AS (
        SELECT
          pt.user_id,
          COUNT(DISTINCT m.id) AS meetings_hosted,
          COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'completed') AS meetings_completed,
          COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'no_show') AS meetings_no_show
        FROM meetings m
        INNER JOIN participants pt ON pt.interaction_id = m.interaction_id
        WHERE m.enterprise_id = ${enterpriseId}
          AND pt.user_id IS NOT NULL
          AND m.scheduled_start_at >= ${fromDate}::timestamptz
          AND m.scheduled_start_at < ${toDate}::timestamptz
        GROUP BY pt.user_id
      ),

      threads_agg AS (
        SELECT
          tm.from_user_id AS user_id,
          COUNT(DISTINCT tm.thread_id) AS total_threads
        FROM thread_messages tm
        WHERE tm.enterprise_id = ${enterpriseId}
          AND tm.from_user_id IS NOT NULL
          AND COALESCE(tm.sent_at, tm.created_at) >= ${fromDate}::timestamptz
          AND COALESCE(tm.sent_at, tm.created_at) < ${toDate}::timestamptz
        GROUP BY tm.from_user_id
      ),

      signals_agg AS (
        SELECT
          ac.user_id,
          COUNT(*) FILTER (WHERE cs.status = 'open') AS open_signals,
          COUNT(*) FILTER (WHERE cs.severity = 'critical' AND cs.status = 'open') AS critical_signals,
          COUNT(*) FILTER (WHERE cs.category_key = 'churn' AND cs.status = 'open') AS churn_signals,
          COUNT(*) FILTER (WHERE cs.category_key = 'expansion' AND cs.status = 'open') AS expansion_signals
        FROM assigned_companies ac
        LEFT JOIN company_signal cs
          ON cs.company_id = ac.company_id AND cs.enterprise_id = ${enterpriseId}
        GROUP BY ac.user_id
      ),

      tasks_agg AS (
        SELECT
          ai.owner_user_id AS user_id,
          COUNT(*) FILTER (WHERE ai.current_stage_id IS NOT NULL) AS open_tasks,
          COUNT(*) FILTER (
            WHERE COALESCE(ai.overdue_at, ai.due_at) IS NOT NULL
              AND COALESCE(ai.overdue_at, ai.due_at) < NOW()
          ) AS overdue_tasks
        FROM action_item ai
        WHERE ai.enterprise_id = ${enterpriseId}
          AND ai.owner_user_id IS NOT NULL
        GROUP BY ai.owner_user_id
      ),

      key_roles_agg AS (
        SELECT
          rm.user_id,
          jsonb_agg(
            jsonb_build_object('key', rm.role_key, 'name', rm.role_name, 'entity_type', rm.entity_type)
            ORDER BY rm.display_order, rm.role_name
          ) AS key_roles
        FROM (
          SELECT DISTINCT
            kra.user_id,
            krd.key AS role_key,
            krd.name AS role_name,
            kra.entity_type,
            krd.display_order
          FROM key_role_assignments kra
          JOIN key_role_definitions krd ON krd.id = kra.key_role_definition_id
          WHERE kra.enterprise_id = ${enterpriseId}
            AND (kra.end_at IS NULL OR kra.end_at > NOW())
        ) rm
        GROUP BY rm.user_id
      ),

      rep_interactions_agg AS (
        SELECT
          pt.user_id,
          COUNT(DISTINCT pt.interaction_id) AS interactions_in_window
        FROM participants pt
        INNER JOIN interaction_org_unit_mapping ioum
          ON ioum.interaction_id = pt.interaction_id
        INNER JOIN interactions i ON i.id = pt.interaction_id
        WHERE ioum.enterprise_id = ${enterpriseId}
          AND pt.user_id IS NOT NULL
          AND i.start_at >= ${fromDate}::timestamptz
          AND i.start_at < ${toDate}::timestamptz
        GROUP BY pt.user_id
      )

      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        COALESCE(ca.total_companies, 0)::int AS total_companies,
        COALESCE(aa.total_accounts, 0)::int AS total_accounts,
        COALESCE(ca.total_arr, 0)::numeric AS total_arr,
        ca.avg_health_score,
        COALESCE(cl.outbound_calls, 0)::int AS outbound_calls,
        COALESCE(cl.inbound_calls, 0)::int AS inbound_calls,
        (COALESCE(cl.outbound_calls, 0) + COALESCE(cl.inbound_calls, 0))::int AS total_calls,
        COALESCE(mt.meetings_hosted, 0)::int AS meetings_hosted,
        COALESCE(mt.meetings_completed, 0)::int AS meetings_completed,
        COALESCE(mt.meetings_no_show, 0)::int AS meetings_no_show,
        COALESCE(thr.total_threads, 0)::int AS total_threads,
        COALESCE(ria.interactions_in_window, 0)::int AS interactions_in_window,
        COALESCE(sig.open_signals, 0)::int AS open_signals,
        COALESCE(sig.critical_signals, 0)::int AS critical_signals,
        COALESCE(sig.churn_signals, 0)::int AS churn_signals,
        COALESCE(sig.expansion_signals, 0)::int AS expansion_signals,
        COALESCE(ta.open_tasks, 0)::int AS open_tasks,
        COALESCE(ta.overdue_tasks, 0)::int AS overdue_tasks,
        COALESCE(kr.key_roles, '[]'::jsonb) AS key_roles
      FROM app_user u
      INNER JOIN user_enterprise ue
        ON ue.user_id = u.id AND ue.enterprise_id = ${enterpriseId}
      LEFT JOIN company_agg ca ON ca.user_id = u.id
      LEFT JOIN accounts_agg aa ON aa.user_id = u.id
      LEFT JOIN calls_agg cl ON cl.user_id = u.id
      LEFT JOIN meetings_agg mt ON mt.user_id = u.id
      LEFT JOIN threads_agg thr ON thr.user_id = u.id
      LEFT JOIN rep_interactions_agg ria ON ria.user_id = u.id
      LEFT JOIN signals_agg sig ON sig.user_id = u.id
      LEFT JOIN tasks_agg ta ON ta.user_id = u.id
      LEFT JOIN key_roles_agg kr ON kr.user_id = u.id
      WHERE ${userFilter}
        ${searchFilter}
        ${roleFilter}
      ${orderClause}
      LIMIT ${limit}
    `);

    const reps = (rows as any[]).map((r) => ({
      name: r.name,
      email: r.email,
      totalCompanies: Number(r.total_companies),
      totalAccounts: Number(r.total_accounts),
      totalArr: Number(r.total_arr),
      avgHealthScore:
        r.avg_health_score != null ? Number(r.avg_health_score) : null,
      outboundCalls: Number(r.outbound_calls),
      inboundCalls: Number(r.inbound_calls),
      totalCalls: Number(r.total_calls),
      meetingsHosted: Number(r.meetings_hosted),
      meetingsCompleted: Number(r.meetings_completed),
      meetingsNoShow: Number(r.meetings_no_show),
      totalThreads: Number(r.total_threads),
      interactionsInWindow: Number(r.interactions_in_window),
      openSignals: Number(r.open_signals),
      criticalSignals: Number(r.critical_signals),
      churnSignals: Number(r.churn_signals),
      expansionSignals: Number(r.expansion_signals),
      openTasks: Number(r.open_tasks),
      overdueTasks: Number(r.overdue_tasks),
      keyRoles: r.key_roles ?? [],
    }));

    const summary = {
      totalReps: reps.length,
      totalArr: reps.reduce((s, r) => s + r.totalArr, 0),
      totalCompanies: reps.reduce((s, r) => s + r.totalCompanies, 0),
      totalAccounts: reps.reduce((s, r) => s + r.totalAccounts, 0),
      totalOpenSignals: reps.reduce((s, r) => s + r.openSignals, 0),
      totalCriticalSignals: reps.reduce((s, r) => s + r.criticalSignals, 0),
      totalOpenTasks: reps.reduce((s, r) => s + r.openTasks, 0),
    };

    return { reps, summary, dateWindow: { from: fromDate, to: toDate } };
  },
});
