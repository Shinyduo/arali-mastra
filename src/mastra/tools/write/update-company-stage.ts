import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companies, stageDefinition } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { logActivity } from "../../../lib/activity-log.js";

export const updateCompanyStage = createTool({
  id: "update-company-stage",
  description:
    "Update a company's lifecycle stage. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    companyName: z.string().describe("Company name"),
    targetStageKey: z.string().describe("Target stage key (e.g. 'onboarding', 'active', 'churned')"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    if (!confirmed) {
      return { needsConfirmation: true, message: `Move "${input.companyName}" to stage "${input.targetStageKey}"?` };
    }

    try {
      const matched = await db
        .select({ id: companies.id, name: companies.name, stageDefinitionId: companies.stageDefinitionId })
        .from(companies)
        .where(and(eq(companies.enterpriseId, enterpriseId), fuzzyNameMatch(companies.name, input.companyName)))
        .limit(1);

      if (!matched[0]) return { success: false, message: `Company "${input.companyName}" not found.` };

      // Fetch old stage name for the log
      let fromStageName: string | undefined;
      if (matched[0].stageDefinitionId) {
        const oldStage = await db
          .select({ name: stageDefinition.name })
          .from(stageDefinition)
          .where(eq(stageDefinition.id, matched[0].stageDefinitionId))
          .limit(1);
        fromStageName = oldStage[0]?.name;
      }

      const stage = await db
        .select({ id: stageDefinition.id, name: stageDefinition.name })
        .from(stageDefinition)
        .where(and(
          eq(stageDefinition.enterpriseId, enterpriseId),
          eq(stageDefinition.scope, "company"),
          eq(stageDefinition.key, input.targetStageKey),
          eq(stageDefinition.isActive, true),
        ))
        .limit(1);

      if (!stage[0]) return { success: false, message: `Stage "${input.targetStageKey}" not found.` };

      await db.update(companies).set({ stageDefinitionId: stage[0].id, updatedAt: new Date() }).where(eq(companies.id, matched[0].id));

      await logActivity({
        enterpriseId,
        entityType: "company",
        entityId: matched[0].id,
        actionType: "stage_changed",
        actorUserId: userId,
        metadata: {
          entity_label: matched[0].name,
          from_label: fromStageName,
          to_label: stage[0].name,
          source: "ai",
        },
      });

      return { success: true, message: `${matched[0].name} moved to stage "${stage[0].name}".` };
    } catch (err: any) {
      return { success: false, message: `Failed: ${err.message}` };
    }
  },
});
