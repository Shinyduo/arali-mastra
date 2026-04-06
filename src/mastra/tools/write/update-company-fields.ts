import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companies, fieldDefinitions, fieldValues } from "../../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";

export const updateCompanyFields = createTool({
  id: "update-company-fields",
  description:
    "Update custom field values on a company. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview changes and see available fields. " +
    "Only set confirmed=true after user approves. " +
    "Each field has a key and type (text, number, date, boolean, enum, multi_enum, json).",
  inputSchema: z.object({
    companyName: z.string().describe("Company name"),
    fields: z
      .array(
        z.object({
          fieldKey: z.string().describe("Custom field key (e.g. 'region', 'contract_value')"),
          value: z
            .union([z.string(), z.number(), z.boolean(), z.null()])
            .describe("Value to set. Use null to clear the field."),
        }),
      )
      .describe("Fields to update"),
    confirmed: z
      .boolean()
      .optional()
      .default(false)
      .describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    // Resolve company
    const matched = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.enterpriseId, enterpriseId), fuzzyNameMatch(companies.name, input.companyName)))
      .limit(1);

    if (!matched[0]) return { success: false, message: `Company "${input.companyName}" not found.` };
    const company = matched[0];

    // Fetch field definitions for this enterprise (company scope)
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
          sql`${fieldDefinitions.entityType} IN ('company', 'companies')`,
        ),
      );

    const defMap = new Map(defs.map((d) => [d.key, d]));

    // Validate all field keys
    const errors: string[] = [];
    const validFields: { def: (typeof defs)[0]; value: string | number | boolean | null }[] = [];

    for (const f of input.fields) {
      const def = defMap.get(f.fieldKey);
      if (!def) {
        errors.push(`Unknown field "${f.fieldKey}"`);
        continue;
      }
      validFields.push({ def, value: f.value });
    }

    if (!confirmed) {
      return {
        needsConfirmation: true,
        company: company.name,
        changes: validFields.map((f) => ({
          field: f.def.name,
          key: f.def.key,
          type: f.def.type,
          newValue: f.value,
        })),
        errors: errors.length > 0 ? errors : undefined,
        availableFields: defs.map((d) => ({
          key: d.key,
          name: d.name,
          type: d.type,
          enumOptions: d.enumOptions,
        })),
        message: errors.length > 0
          ? `Some fields are invalid. Please fix and try again.`
          : `Update ${validFields.length} field(s) on "${company.name}"?`,
      };
    }

    if (errors.length > 0) {
      return { success: false, message: `Invalid fields: ${errors.join(", ")}`, availableFields: defs.map((d) => ({ key: d.key, name: d.name, type: d.type })) };
    }

    try {
      for (const f of validFields) {
        // Build the value columns based on field type
        const valueColumns: Record<string, unknown> = {
          valueText: null,
          valueNumber: null,
          valueDate: null,
          valueBool: null,
          valueJson: null,
        };

        if (f.value === null) {
          // Clear — all null
        } else {
          switch (f.def.type) {
            case "text":
            case "enum":
              valueColumns.valueText = String(f.value);
              break;
            case "number":
              valueColumns.valueNumber = String(f.value);
              break;
            case "date":
              valueColumns.valueDate = new Date(String(f.value));
              break;
            case "boolean":
              valueColumns.valueBool = Boolean(f.value);
              break;
            case "json":
            case "multi_enum":
              valueColumns.valueJson = typeof f.value === "string" ? JSON.parse(f.value) : f.value;
              break;
          }
        }

        // Upsert: insert or update on conflict
        await db
          .insert(fieldValues)
          .values({
            enterpriseId,
            fieldDefinitionId: f.def.id,
            entityType: "company",
            entityId: company.id,
            ...valueColumns,
          } as any)
          .onConflictDoUpdate({
            target: [fieldValues.enterpriseId, fieldValues.entityType, fieldValues.entityId, fieldValues.fieldDefinitionId],
            set: { ...valueColumns, updatedAt: new Date() } as any,
          });
      }

      return {
        success: true,
        message: `Updated ${validFields.length} field(s) on "${company.name}".`,
      };
    } catch (err: any) {
      return { success: false, message: `Failed: ${err.message}` };
    }
  },
});
