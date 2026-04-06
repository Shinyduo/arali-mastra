import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  actionItem,
  actionItemEntity,
  pipelineStage,
  companies,
  appUser,
} from "../../../db/schema.js";
import { eq, and, lt, gte, lte, asc, desc, count, sql, isNull } from "drizzle-orm";
import { extractContext, getCompanyScope, buildOwnerScopeFilter, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getActionItems = createTool({
  id: "get-action-items",
  description:
    "List action items (tasks/to-dos) with optional filters for status, priority, owner, overdue, " +
    "date range, or associated company. Use this for queries like 'my overdue tasks', " +
    "'high priority action items', 'action items for Acme Corp', 'tasks created this week', " +
    "'unassigned action items', 'items due this week', or 'what tasks were completed today?'.",
  inputSchema: z.object({
    status: z
      .enum(["open", "in_progress", "blocked", "done", "archived"])
      .optional()
      .describe(
        "Filter by status bucket (maps to the pipeline stage's bucket field)",
      ),
    priority: z
      .enum(["low", "medium", "high", "blocker"])
      .optional()
      .describe("Filter by priority level"),
    ownerEmail: z
      .string()
      .email()
      .optional()
      .describe("Filter by action item owner's email"),
    unassigned: z
      .boolean()
      .optional()
      .describe("If true, only show items with no assigned owner"),
    overdue: z
      .boolean()
      .optional()
      .describe("If true, only show items where dueAt is in the past"),
    dueBefore: z
      .string()
      .optional()
      .describe("Only items due on or before this date (YYYY-MM-DD). Use for 'due this week'."),
    dueAfter: z
      .string()
      .optional()
      .describe("Only items due on or after this date (YYYY-MM-DD)"),
    createdAfter: z
      .string()
      .optional()
      .describe("Only items created on or after this date (YYYY-MM-DD). Use for 'tasks created today'."),
    createdBefore: z
      .string()
      .optional()
      .describe("Only items created on or before this date (YYYY-MM-DD)"),
    companyName: z
      .string()
      .optional()
      .describe("Filter by associated company name (partial match)"),
    sortBy: z
      .enum(["dueAt", "createdAt", "priority"])
      .optional()
      .default("dueAt")
      .describe("Sort field. Default: dueAt."),
    sortOrder: z
      .enum(["asc", "desc"])
      .optional()
      .default("desc")
      .describe("Sort direction"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe("Max results to return"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("Offset for pagination"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const ownerScopeFilter = buildOwnerScopeFilter(
      getCompanyScope(capabilities),
      userId,
      actionItem.ownerUserId,
    );

    const conditions = [
      eq(actionItem.enterpriseId, enterpriseId),
      ownerScopeFilter,
      input.status
        ? eq(pipelineStage.bucket, input.status)
        : undefined,
      input.priority ? eq(actionItem.priority, input.priority) : undefined,
      input.ownerEmail ? eq(appUser.email, input.ownerEmail) : undefined,
      input.unassigned ? isNull(actionItem.ownerUserId) : undefined,
      input.overdue
        ? sql`COALESCE(${actionItem.overdueAt}, ${actionItem.dueAt}) < NOW()`
        : undefined,
      input.dueBefore
        ? sql`COALESCE(${actionItem.overdueAt}, ${actionItem.dueAt}) <= ${input.dueBefore + "T23:59:59.999Z"}::timestamptz`
        : undefined,
      input.dueAfter
        ? sql`COALESCE(${actionItem.overdueAt}, ${actionItem.dueAt}) >= ${input.dueAfter}::timestamptz`
        : undefined,
      input.createdAfter
        ? gte(actionItem.createdAt, new Date(input.createdAfter))
        : undefined,
      input.createdBefore
        ? lte(actionItem.createdAt, new Date(input.createdBefore + "T23:59:59.999Z"))
        : undefined,
      input.companyName
        ? fuzzyNameMatch(companies.name, input.companyName!)
        : undefined,
    ].filter(Boolean);

    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    const sortBy = input.sortBy ?? "dueAt";
    const sortOrder = input.sortOrder ?? "desc";
    const orderFn = sortOrder === "desc" ? desc : asc;
    const sortColumnMap = {
      dueAt: actionItem.dueAt,
      createdAt: actionItem.createdAt,
      priority: actionItem.priority,
    } as const;

    const [rows, [countResult]] = await Promise.all([
      db
        .select({
          title: actionItem.title,
          description: actionItem.description,
          priority: actionItem.priority,
          overdueAt: actionItem.overdueAt,
          dueAt: actionItem.dueAt,
          createdAt: actionItem.createdAt,
          ownerName: appUser.name,
          ownerEmail: appUser.email,
          stageName: pipelineStage.name,
          stageBucket: pipelineStage.bucket,
          companyName: companies.name,
        })
        .from(actionItem)
        .leftJoin(appUser, eq(actionItem.ownerUserId, appUser.id))
        .leftJoin(
          pipelineStage,
          eq(actionItem.currentStageId, pipelineStage.id),
        )
        .leftJoin(
          actionItemEntity,
          and(
            eq(actionItemEntity.actionItemId, actionItem.id),
            eq(actionItemEntity.entityType, "company"),
          ),
        )
        .leftJoin(companies, eq(actionItemEntity.entityId, companies.id))
        .where(and(...conditions))
        .orderBy(orderFn(sortColumnMap[sortBy]))
        .limit(limit)
        .offset(offset),

      db
        .select({ total: count() })
        .from(actionItem)
        .leftJoin(appUser, eq(actionItem.ownerUserId, appUser.id))
        .leftJoin(
          pipelineStage,
          eq(actionItem.currentStageId, pipelineStage.id),
        )
        .leftJoin(
          actionItemEntity,
          and(
            eq(actionItemEntity.actionItemId, actionItem.id),
            eq(actionItemEntity.entityType, "company"),
          ),
        )
        .leftJoin(companies, eq(actionItemEntity.entityId, companies.id))
        .where(and(...conditions)),
    ]);

    const now = new Date();
    return {
      actionItems: rows.map((r) => {
        const effectiveDue = r.overdueAt ?? r.dueAt;
        const isOverdue = effectiveDue ? effectiveDue < now : false;
        const daysOverdue = isOverdue && effectiveDue
          ? Math.floor((now.getTime() - effectiveDue.getTime()) / 86400000)
          : null;

        return {
          title: r.title,
          description: r.description ?? "—",
          priority: r.priority,
          dueAt: effectiveDue?.toISOString().slice(0, 10) ?? "No due date",
          isOverdue,
          daysOverdue,
          createdAt: r.createdAt?.toISOString().slice(0, 10) ?? "—",
          owner: r.ownerName ?? "Unassigned",
          status: r.stageBucket ?? "unknown",
          stageName: r.stageName ?? "—",
          company: r.companyName ?? "—",
        };
      }),
      totalCount: countResult?.total ?? 0,
    };
  },
});
