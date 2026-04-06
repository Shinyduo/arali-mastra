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
import { eq, and, lt, desc, count, sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildOwnerScopeFilter, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getActionItems = createTool({
  id: "get-action-items",
  description:
    "List action items (tasks/to-dos) with optional filters for status, priority, owner, overdue, " +
    "or associated company. Use this for queries like 'my overdue tasks', 'high priority action items', " +
    "or 'action items for Acme Corp'.",
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
    overdue: z
      .boolean()
      .optional()
      .describe("If true, only show items where dueAt is in the past"),
    companyName: z
      .string()
      .optional()
      .describe("Filter by associated company name (partial match)"),
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
      input.overdue ? lt(actionItem.dueAt, new Date()) : undefined,
      input.companyName
        ? fuzzyNameMatch(companies.name, input.companyName!)
        : undefined,
    ].filter(Boolean);

    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    const [rows, [countResult]] = await Promise.all([
      db
        .select({
          title: actionItem.title,
          description: actionItem.description,
          priority: actionItem.priority,
          dueAt: actionItem.dueAt,
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
        .orderBy(desc(actionItem.dueAt))
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
      actionItems: rows.map((r) => ({
        title: r.title,
        description: r.description ?? "—",
        priority: r.priority,
        dueAt: r.dueAt?.toISOString().slice(0, 10) ?? "No due date",
        isOverdue: r.dueAt ? r.dueAt < now : false,
        owner: r.ownerName ?? "Unassigned",
        status: r.stageBucket ?? "unknown",
        stageName: r.stageName ?? "—",
        company: r.companyName ?? "—",
      })),
      totalCount: countResult?.total ?? 0,
    };
  },
});
