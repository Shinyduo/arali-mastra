import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { actionItem, pipelineStage } from "../../../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";
import { callBackendApi } from "../../../lib/backend-api.js";

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
    const { enterpriseId, jwt } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    // Resolve action item title → id (local fuzzy lookup; public API has no search-by-title)
    const items = await db
      .select({ id: actionItem.id, title: actionItem.title })
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

    // Resolve target stage name → id
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

    if (!confirmed) {
      return {
        needsConfirmation: true,
        actionItem: items[0].title,
        targetStage: stages[0].name,
        message: `Move "${items[0].title}" to stage "${stages[0].name}"?`,
      };
    }

    const resp = await callBackendApi({
      method: "PATCH",
      path: `/api/v1/action-items/${items[0].id}`,
      body: { stageId: stages[0].id },
      jwt,
    });

    if (!resp.ok) {
      return { success: false, message: `Failed to update stage: ${resp.error}` };
    }

    return { success: true, message: `"${items[0].title}" moved to "${stages[0].name}".` };
  },
});
