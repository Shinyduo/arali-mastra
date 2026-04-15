import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { contacts, stageDefinition } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { callBackendApi } from "../../../lib/backend-api.js";

export const updateContactStage = createTool({
  id: "update-contact-stage",
  description:
    "Update a contact's lifecycle stage (e.g. 'new_lead' → 'qualified'). " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    contactName: z.string().describe("Contact full name (fuzzy match)"),
    targetStageKey: z
      .string()
      .describe("Target contact stage key (e.g. 'new_lead', 'qualified', 'customer')"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, jwt } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    // Read-only lookup: fuzzy-match contact → UUID
    const matched = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        stageDefinitionId: contacts.stageDefinitionId,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.enterpriseId, enterpriseId),
          fuzzyNameMatch(contacts.fullName, input.contactName),
        ),
      )
      .limit(1);

    if (!matched[0]) return { success: false, message: `Contact "${input.contactName}" not found.` };

    // Validate target stage (contact scope)
    const stage = await db
      .select({ id: stageDefinition.id, name: stageDefinition.name })
      .from(stageDefinition)
      .where(
        and(
          eq(stageDefinition.enterpriseId, enterpriseId),
          eq(stageDefinition.scope, "contact"),
          eq(stageDefinition.key, input.targetStageKey),
          eq(stageDefinition.isActive, true),
        ),
      )
      .limit(1);

    if (!stage[0]) return { success: false, message: `Stage "${input.targetStageKey}" not found for contacts.` };

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
        contact: matched[0].fullName,
        from: fromStageName ?? "—",
        to: stage[0].name,
        message: `Move "${matched[0].fullName}" from "${fromStageName ?? "—"}" to "${stage[0].name}"?`,
      };
    }

    // Mutation: PUT /api/v1/contacts/:id — backend updates stage, writes activity log, publishes workflow.trigger
    const resp = await callBackendApi({
      method: "PUT",
      path: `/api/v1/contacts/${matched[0].id}`,
      body: { stageKey: input.targetStageKey },
      jwt,
    });

    if (!resp.ok) {
      return { success: false, message: `Failed to update stage: ${resp.error}` };
    }

    return { success: true, message: `${matched[0].fullName} moved to stage "${stage[0].name}".` };
  },
});
