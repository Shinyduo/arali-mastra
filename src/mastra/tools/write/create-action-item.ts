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
    "Create a new action item (task/to-do). Requires confirmation before execution. " +
    "Provide a title, optional description, owner email, priority, due date, and company name.",
  inputSchema: z.object({
    title: z.string().describe("Action item title"),
    description: z.string().optional().describe("Detailed description"),
    ownerEmail: z
      .string()
      .email()
      .optional()
      .describe("Email of the person to assign this to"),
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
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);

    // If resumed — user approved, execute the write
    if (context.agent?.resumeData != null) {
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

        // Find default pipeline and first stage
        const pipeline = await db
          .select({ id: actionItemsPipeline.id })
          .from(actionItemsPipeline)
          .where(eq(actionItemsPipeline.enterpriseId, enterpriseId))
          .limit(1);

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

        // Link to company if specified
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
          message: `Action item "${input.title}" created successfully.`,
        };
      } catch (err: any) {
        return { success: false, message: `Failed to create action item: ${err.message}` };
      }
    }

    // First call: suspend for confirmation
    const summary = [
      `**Title:** ${input.title}`,
      input.description ? `**Description:** ${input.description}` : null,
      `**Priority:** ${input.priority ?? "medium"}`,
      `**Owner:** ${input.ownerEmail ?? "you"}`,
      input.dueAt ? `**Due:** ${input.dueAt}` : null,
      input.companyName ? `**Company:** ${input.companyName}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await context.agent?.suspend({
      action: "create-action-item",
      summary: `Create action item:\n${summary}`,
    });
  },
});
