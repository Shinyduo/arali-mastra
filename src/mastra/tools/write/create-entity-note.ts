import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { entityNotes, companies, contacts, accounts } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { logActivity } from "../../../lib/activity-log.js";

export const createEntityNote = createTool({
  id: "create-entity-note",
  description:
    "Create a note on a company, contact, or account. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    entityType: z.enum(["company", "contact", "account"]).describe("Entity type"),
    entityName: z.string().describe("Name of the entity (partial match)"),
    title: z.string().optional().describe("Note title"),
    content: z.string().describe("Note content"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    if (!confirmed) {
      return {
        needsConfirmation: true,
        message: `Create note on ${input.entityType} "${input.entityName}"?\nTitle: ${input.title ?? "none"}\nContent: ${input.content.slice(0, 100)}${input.content.length > 100 ? "…" : ""}`,
      };
    }

    try {
      let entityId: string | null = null;
      let resolvedName = "";

      if (input.entityType === "company") {
        const m = await db.select({ id: companies.id, name: companies.name }).from(companies)
          .where(and(eq(companies.enterpriseId, enterpriseId), fuzzyNameMatch(companies.name, input.entityName))).limit(1);
        entityId = m[0]?.id ?? null; resolvedName = m[0]?.name ?? "";
      } else if (input.entityType === "contact") {
        const m = await db.select({ id: contacts.id, name: contacts.fullName }).from(contacts)
          .where(and(eq(contacts.enterpriseId, enterpriseId), fuzzyNameMatch(contacts.fullName, input.entityName))).limit(1);
        entityId = m[0]?.id ?? null; resolvedName = m[0]?.name ?? "";
      } else if (input.entityType === "account") {
        const m = await db.select({ id: accounts.id, name: accounts.name }).from(accounts)
          .where(and(eq(accounts.enterpriseId, enterpriseId), fuzzyNameMatch(accounts.name, input.entityName))).limit(1);
        entityId = m[0]?.id ?? null; resolvedName = m[0]?.name ?? "";
      }

      if (!entityId) return { success: false, message: `No ${input.entityType} found matching "${input.entityName}".` };

      await db.insert(entityNotes).values({
        enterpriseId, entityType: input.entityType, entityId,
        title: input.title ?? null, content: input.content,
        createdByUserId: userId, updatedByUserId: userId,
      });

      await logActivity({
        enterpriseId,
        entityType: input.entityType as "company" | "contact" | "account",
        entityId,
        actionType: "note_created",
        actorUserId: userId,
        metadata: { entity_label: resolvedName, source: "ai" },
      });

      return { success: true, message: `Note added to ${input.entityType} "${resolvedName}".` };
    } catch (err: any) {
      return { success: false, message: `Failed: ${err.message}` };
    }
  },
});
