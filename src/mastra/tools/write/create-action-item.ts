import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  actionItem,
  actionItemEntity,
  appUser,
  companies,
  pipelineStage,
  actionItemsPipeline,
} from "../../../db/schema.js";
import { eq, and, asc, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const createActionItem = createTool({
  id: "create-action-item",
  description:
    "Create a new action item (task/to-do). " +
    "IMPORTANT: First call this WITHOUT confirmed=true to preview what will be created. " +
    "Only set confirmed=true after the user explicitly approves. " +
    "If the user doesn't specify a pipeline, leave pipelineName empty to use the default. " +
    "If the user refers to someone by first name, use get-team-members first to resolve their email.",
  inputSchema: z.object({
    title: z.string().describe("Action item title"),
    description: z.string().optional().describe("Detailed description"),
    ownerEmail: z
      .string()
      .email()
      .optional()
      .describe("Email of the person to assign this to (use get-team-members to resolve names)"),
    priority: z
      .enum(["low", "medium", "high", "blocker"])
      .optional()
      .default("medium"),
    dueAt: z
      .string()
      .optional()
      .describe("Due date in ISO format (YYYY-MM-DD)"),
    companyName: z
      .string()
      .optional()
      .describe("Company to link this action item to"),
    pipelineName: z
      .string()
      .optional()
      .describe("Pipeline name. Leave empty to use the default pipeline."),
    confirmed: z
      .boolean()
      .optional()
      .default(false)
      .describe("Set to true only after the user has confirmed the action"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    if (!confirmed) {
      // Fetch available pipelines so the agent can show them
      const pipelines = await db
        .select({
          name: actionItemsPipeline.name,
          isDefault: actionItemsPipeline.isDefault,
        })
        .from(actionItemsPipeline)
        .where(eq(actionItemsPipeline.enterpriseId, enterpriseId));

      const selectedPipeline = input.pipelineName
        ? pipelines.find((p) => p.name.toLowerCase() === input.pipelineName!.toLowerCase())?.name
        : pipelines.find((p) => p.isDefault)?.name ?? pipelines[0]?.name;

      return {
        needsConfirmation: true,
        summary: {
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? "medium",
          owner: input.ownerEmail ?? "you",
          dueAt: input.dueAt ?? "none",
          company: input.companyName ?? "none",
          pipeline: selectedPipeline ?? "default",
        },
        availablePipelines: pipelines.map((p) => `${p.name}${p.isDefault ? " (default)" : ""}`),
        message: "Please confirm to create this action item.",
      };
    }

    try {
      const ownerUser = input.ownerEmail
        ? (
            await db
              .select({ id: appUser.id })
              .from(appUser)
              .where(eq(appUser.email, input.ownerEmail))
              .limit(1)
          )[0]
        : null;

      // Find pipeline: by name, or default, or first available
      let pipelineConditions;
      if (input.pipelineName) {
        pipelineConditions = and(
          eq(actionItemsPipeline.enterpriseId, enterpriseId),
          ilike(actionItemsPipeline.name, input.pipelineName),
        );
      } else {
        pipelineConditions = and(
          eq(actionItemsPipeline.enterpriseId, enterpriseId),
          eq(actionItemsPipeline.isDefault, true),
        );
      }

      let pipeline = await db
        .select({ id: actionItemsPipeline.id, name: actionItemsPipeline.name })
        .from(actionItemsPipeline)
        .where(pipelineConditions)
        .limit(1);

      // Fallback to any pipeline if default not found
      if (!pipeline[0]) {
        pipeline = await db
          .select({ id: actionItemsPipeline.id, name: actionItemsPipeline.name })
          .from(actionItemsPipeline)
          .where(eq(actionItemsPipeline.enterpriseId, enterpriseId))
          .limit(1);
      }

      let firstStageId: string | null = null;
      if (pipeline[0]) {
        const stages = await db
          .select({ id: pipelineStage.id })
          .from(pipelineStage)
          .where(eq(pipelineStage.pipelineId, pipeline[0].id))
          .orderBy(asc(pipelineStage.sortOrder))
          .limit(1);
        firstStageId = stages[0]?.id ?? null;
      }

      const [created] = await db
        .insert(actionItem)
        .values({
          enterpriseId,
          title: input.title,
          description: input.description ?? null,
          ownerUserId: ownerUser?.id ?? userId,
          priority: input.priority ?? "medium",
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          currentStageId: firstStageId,
        })
        .returning({ id: actionItem.id });

      if (input.companyName && created) {
        const company = await db
          .select({ id: companies.id })
          .from(companies)
          .where(
            and(
              eq(companies.enterpriseId, enterpriseId),
              ilike(companies.name, `%${input.companyName}%`),
            ),
          )
          .limit(1);

        if (company[0]) {
          await db.insert(actionItemEntity).values({
            enterpriseId,
            actionItemId: created.id,
            entityType: "company",
            entityId: company[0].id,
          });
        }
      }

      return {
        success: true,
        message: `Action item "${input.title}" created in pipeline "${pipeline[0]?.name ?? "default"}".`,
      };
    } catch (err: any) {
      return { success: false, message: `Failed to create action item: ${err.message}` };
    }
  },
});
