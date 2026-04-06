import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { actionItem, pipelineStage } from "../../../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const updateActionItemStage = createTool({
  id: "update-action-item-stage",
  description:
    "Update the stage/status of an action item. Requires confirmation. " +
    "Provide the action item title (or partial match) and the target stage name.",
  inputSchema: z.object({
    actionItemTitle: z
      .string()
      .describe("Action item title to search for (partial match)"),
    targetStageName: z
      .string()
      .describe("Name of the target stage (e.g. 'In Progress', 'Done')"),
  }),
  suspendSchema: z.object({
    action: z.literal("update-action-item-stage"),
    summary: z.string(),
  }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);

    if (context.agent?.resumeData) {
      const resume = context.agent.resumeData as { approved: boolean };
      if (!resume.approved) {
        return { success: false, message: "Stage update cancelled." };
      }

      // Find the action item
      const items = await db
        .select({ id: actionItem.id, title: actionItem.title, currentStageId: actionItem.currentStageId })
        .from(actionItem)
        .where(
          and(
            eq(actionItem.enterpriseId, enterpriseId),
            ilike(actionItem.title, `%${input.actionItemTitle}%`),
          ),
        )
        .limit(1);

      if (!items[0]) {
        return { success: false, message: `No action item found matching "${input.actionItemTitle}".` };
      }

      // Find the target stage
      const stages = await db
        .select({ id: pipelineStage.id, name: pipelineStage.name })
        .from(pipelineStage)
        .where(
          and(
            eq(pipelineStage.enterpriseId, enterpriseId),
            ilike(pipelineStage.name, `%${input.targetStageName}%`),
          ),
        )
        .limit(1);

      if (!stages[0]) {
        return { success: false, message: `No stage found matching "${input.targetStageName}".` };
      }

      await db
        .update(actionItem)
        .set({ currentStageId: stages[0].id, updatedAt: new Date() })
        .where(eq(actionItem.id, items[0].id));

      return {
        success: true,
        message: `"${items[0].title}" moved to "${stages[0].name}".`,
      };
    }

    await context.agent?.suspend({
      action: "update-action-item-stage",
      summary: `Move "${input.actionItemTitle}" to stage "${input.targetStageName}"`,
    });

    return { success: false, message: "Awaiting confirmation." };
  },
});
