import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companies, stageDefinition } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { callBackendApi } from "../../../lib/backend-api.js";

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
    const { enterpriseId, jwt } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    // Read-only lookup: fuzzy-match the company name → UUID (public API has no fuzzy-by-name endpoint)
    const matched = await db
      .select({ id: companies.id, name: companies.name, stageDefinitionId: companies.stageDefinitionId })
      .from(companies)
      .where(and(eq(companies.enterpriseId, enterpriseId), fuzzyNameMatch(companies.name, input.companyName)))
      .limit(1);

    if (!matched[0]) return { success: false, message: `Company "${input.companyName}" not found.` };

    // Validate target stage exists before preview/confirm
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

    if (!stage[0]) return { success: false, message: `Stage "${input.targetStageKey}" not found for companies.` };

    // Resolve current stage label for preview
    let fromStageName: string | undefined;
    if (matched[0].stageDefinitionId) {
      const oldStage = await db
        .select({ name: stageDefinition.name })
        .from(stageDefinition)
        .where(eq(stageDefinition.id, matched[0].stageDefinitionId))
        .limit(1);
      fromStageName = oldStage[0]?.name;
    }

    if (!confirmed) {
      return {
        needsConfirmation: true,
        company: matched[0].name,
        from: fromStageName ?? "—",
        to: stage[0].name,
        message: `Move "${matched[0].name}" from "${fromStageName ?? "—"}" to "${stage[0].name}"?`,
      };
    }

    // Mutation: PUT /api/v1/companies/:id — backend writes stage, entity_activity_log, and publishes workflow.trigger
    const resp = await callBackendApi({
      method: "PUT",
      path: `/api/v1/companies/${matched[0].id}`,
      body: { stageKey: input.targetStageKey },
      jwt,
    });

    if (!resp.ok) {
      return { success: false, message: `Failed to update stage: ${resp.error}` };
    }

    return { success: true, message: `${matched[0].name} moved to stage "${stage[0].name}".` };
  },
});
