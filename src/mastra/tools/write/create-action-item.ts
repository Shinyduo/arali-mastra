import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  appUser,
  companies,
  pipelineStage,
  actionItemsPipeline,
} from "../../../db/schema.js";
import { eq, and, asc, ilike } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { callBackendApi } from "../../../lib/backend-api.js";

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
    const { enterpriseId, userId, jwt } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    if (!confirmed) {
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

    // Resolve owner email → userId (public API wants ownerUserId directly)
    const ownerUser = input.ownerEmail
      ? (
          await db
            .select({ id: appUser.id })
            .from(appUser)
            .where(eq(appUser.email, input.ownerEmail))
            .limit(1)
        )[0]
      : null;
    const resolvedOwnerUserId = ownerUser?.id ?? userId;

    // Resolve pipeline name → first stage's id (public API wants stageId)
    let resolvedStageId: string | null = null;
    let resolvedPipelineName: string = "default";
    {
      const pipelineCond = input.pipelineName
        ? and(
            eq(actionItemsPipeline.enterpriseId, enterpriseId),
            ilike(actionItemsPipeline.name, input.pipelineName),
          )
        : and(
            eq(actionItemsPipeline.enterpriseId, enterpriseId),
            eq(actionItemsPipeline.isDefault, true),
          );

      let [pipeline] = await db
        .select({ id: actionItemsPipeline.id, name: actionItemsPipeline.name })
        .from(actionItemsPipeline)
        .where(pipelineCond)
        .limit(1);

      if (!pipeline) {
        [pipeline] = await db
          .select({ id: actionItemsPipeline.id, name: actionItemsPipeline.name })
          .from(actionItemsPipeline)
          .where(eq(actionItemsPipeline.enterpriseId, enterpriseId))
          .limit(1);
      }

      if (pipeline) {
        resolvedPipelineName = pipeline.name;
        const [firstStage] = await db
          .select({ id: pipelineStage.id })
          .from(pipelineStage)
          .where(eq(pipelineStage.pipelineId, pipeline.id))
          .orderBy(asc(pipelineStage.sortOrder))
          .limit(1);
        resolvedStageId = firstStage?.id ?? null;
      }
    }

    // Resolve company name → companyId (for entities array)
    const entities: Array<{ entityType: "company"; entityId: string }> = [];
    if (input.companyName) {
      const company = await db
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            eq(companies.enterpriseId, enterpriseId),
            fuzzyNameMatch(companies.name, input.companyName),
          ),
        )
        .limit(1);
      if (company[0]) {
        entities.push({ entityType: "company", entityId: company[0].id });
      }
    }

    const resp = await callBackendApi({
      method: "POST",
      path: "/api/v1/action-items",
      body: {
        title: input.title,
        description: input.description ?? null,
        ownerUserId: resolvedOwnerUserId,
        priority: input.priority ?? "medium",
        dueAt: input.dueAt ?? null,
        stageId: resolvedStageId,
        entities: entities.length > 0 ? entities : undefined,
      },
      jwt,
    });

    if (!resp.ok) {
      return { success: false, message: `Failed to create action item: ${resp.error}` };
    }

    return {
      success: true,
      message: `Action item "${input.title}" created in pipeline "${resolvedPipelineName}".`,
    };
  },
});
