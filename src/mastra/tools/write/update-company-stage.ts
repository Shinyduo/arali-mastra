import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companies, stageDefinition } from "../../../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const updateCompanyStage = createTool({
  id: "update-company-stage",
  description:
    "Update a company's lifecycle stage. Requires confirmation. " +
    "Provide the company name and target stage key (e.g. 'onboarding', 'active', 'churned').",
  inputSchema: z.object({
    companyName: z.string().describe("Company name"),
    targetStageKey: z
      .string()
      .describe("Target stage key (e.g. 'onboarding', 'active', 'churned')"),
  }),
  suspendSchema: z.object({
    action: z.literal("update-company-stage"),
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

      // Find the company
      const matched = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(
          and(
            eq(companies.enterpriseId, enterpriseId),
            ilike(companies.name, `%${input.companyName}%`),
          ),
        )
        .limit(1);

      if (!matched[0]) {
        return { success: false, message: `Company "${input.companyName}" not found.` };
      }

      // Validate stage exists for scope=company
      const stage = await db
        .select({ id: stageDefinition.id, name: stageDefinition.name })
        .from(stageDefinition)
        .where(
          and(
            eq(stageDefinition.enterpriseId, enterpriseId),
            eq(stageDefinition.scope, "company"),
            eq(stageDefinition.key, input.targetStageKey),
            eq(stageDefinition.isActive, true),
          ),
        )
        .limit(1);

      if (!stage[0]) {
        return {
          success: false,
          message: `Stage "${input.targetStageKey}" not found. Check the stage key.`,
        };
      }

      await db
        .update(companies)
        .set({ stageDefinitionId: stage[0].id, updatedAt: new Date() })
        .where(eq(companies.id, matched[0].id));

      return {
        success: true,
        message: `${matched[0].name} moved to stage "${stage[0].name}".`,
      };
    }

    await context.agent?.suspend({
      action: "update-company-stage",
      summary: `Move "${input.companyName}" to stage "${input.targetStageKey}"`,
    });

    return { success: false, message: "Awaiting confirmation." };
  },
});
