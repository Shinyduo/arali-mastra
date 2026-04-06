import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { actionItem, pipelineStage } from "../../../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const updateActionItemStage = createTool({
  id: "update-action-item-stage",
  description:
    "Update the stage/status of an action item. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    actionItemTitle: z.string().describe("Action item title (partial match)"),
    targetStageName: z.string().describe("Target stage name (e.g. 'In Progress', 'Done')"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    if (!confirmed) {
      return {
        needsConfirmation: true,
        message: `Move "${input.actionItemTitle}" to stage "${input.targetStageName}"?`,
      };
    }

    try {
      const items = await db
        .select({ id: actionItem.id, title: actionItem.title })
        .from(actionItem)
        .where(and(eq(actionItem.enterpriseId, enterpriseId), ilike(actionItem.title, `%${input.actionItemTitle}%`)))
        .limit(1);

      if (!items[0]) return { success: false, message: `No action item found matching "${input.actionItemTitle}".` };

      const stages = await db
        .select({ id: pipelineStage.id, name: pipelineStage.name })
        .from(pipelineStage)
        .where(and(eq(pipelineStage.enterpriseId, enterpriseId), ilike(pipelineStage.name, `%${input.targetStageName}%`)))
        .limit(1);

      if (!stages[0]) return { success: false, message: `No stage found matching "${input.targetStageName}".` };

      await db.update(actionItem).set({ currentStageId: stages[0].id, updatedAt: new Date() }).where(eq(actionItem.id, items[0].id));

      return { success: true, message: `"${items[0].title}" moved to "${stages[0].name}".` };
    } catch (err: any) {
      return { success: false, message: `Failed: ${err.message}` };
    }
  },
});
