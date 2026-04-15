import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { contacts, fieldDefinitions } from "../../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { callBackendApi } from "../../../lib/backend-api.js";

export const updateContactFields = createTool({
  id: "update-contact-fields",
  description:
    "Update custom field values on a contact (e.g. 'region', 'lead_source'). " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview changes and see available fields. " +
    "Only set confirmed=true after user approves. " +
    "Each field has a key and type (text, number, date, boolean, enum, multi_enum, json).",
  inputSchema: z.object({
    contactName: z.string().describe("Contact full name (fuzzy match)"),
    fields: z
      .array(
        z.object({
          fieldKey: z.string().describe("Custom field key (e.g. 'region', 'lead_source')"),
          value: z
            .string()
            .nullable()
            .describe("Value as string (e.g. '42', 'true', '2024-01-01'). Use null to clear the field."),
        }),
      )
      .describe("Fields to update"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, jwt } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    // Read-only lookup: fuzzy-match contact → UUID
    const matched = await db
      .select({ id: contacts.id, fullName: contacts.fullName })
      .from(contacts)
      .where(
        and(
          eq(contacts.enterpriseId, enterpriseId),
          fuzzyNameMatch(contacts.fullName, input.contactName),
        ),
      )
      .limit(1);

    if (!matched[0]) return { success: false, message: `Contact "${input.contactName}" not found.` };
    const contact = matched[0];

    // Read-only lookup: contact field definitions (for preview + client-side key validation)
    const defs = await db
      .select({
        id: fieldDefinitions.id,
        key: fieldDefinitions.fieldKey,
        name: fieldDefinitions.fieldName,
        type: fieldDefinitions.fieldType,
        enumOptions: fieldDefinitions.enumOptions,
      })
      .from(fieldDefinitions)
      .where(
        and(
          eq(fieldDefinitions.enterpriseId, enterpriseId),
          sql`${fieldDefinitions.entityType} IN ('contact', 'contacts')`,
        ),
      );

    const defMap = new Map(defs.map((d) => [d.key, d]));

    const errors: string[] = [];
    const validFields: { def: (typeof defs)[0]; rawValue: string | null }[] = [];

    for (const f of input.fields) {
      const def = defMap.get(f.fieldKey);
      if (!def) {
        errors.push(`Unknown field "${f.fieldKey}"`);
        continue;
      }
      validFields.push({ def, rawValue: f.value });
    }

    if (!confirmed) {
      return {
        needsConfirmation: true,
        contact: contact.fullName,
        changes: validFields.map((f) => ({
          field: f.def.name,
          key: f.def.key,
          type: f.def.type,
          newValue: f.rawValue,
        })),
        errors: errors.length > 0 ? errors : undefined,
        availableFields: defs.map((d) => ({
          key: d.key,
          name: d.name,
          type: d.type,
          enumOptions: d.enumOptions,
        })),
        message:
          errors.length > 0
            ? `Some fields are invalid. Please fix and try again.`
            : `Update ${validFields.length} field(s) on "${contact.fullName}"?`,
      };
    }

    if (errors.length > 0) {
      return {
        success: false,
        message: `Invalid fields: ${errors.join(", ")}`,
        availableFields: defs.map((d) => ({ key: d.key, name: d.name, type: d.type })),
      };
    }

    const properties: Record<string, unknown> = {};
    for (const f of validFields) {
      properties[f.def.key] = f.rawValue;
    }

    // Mutation: PUT /api/v1/contacts/:id — backend handles field_values upsert + activity log + workflow.trigger
    const resp = await callBackendApi({
      method: "PUT",
      path: `/api/v1/contacts/${contact.id}`,
      body: { properties },
      jwt,
    });

    if (!resp.ok) {
      return { success: false, message: `Failed to update fields: ${resp.error}` };
    }

    return {
      success: true,
      message: `Updated ${validFields.length} field(s) on "${contact.fullName}".`,
    };
  },
});
