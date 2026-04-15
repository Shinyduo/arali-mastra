import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../../../db/index.js";
import { companies, appUser } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { callBackendApi } from "../../../lib/backend-api.js";

interface ContactsPostResponse {
  success?: boolean;
  results?: Array<{
    externalId: string;
    contactId?: string;
    status: "success" | "skipped" | "error";
    reason?: string;
    error?: string;
  }>;
}

export const createContact = createTool({
  id: "create-contact",
  description:
    "Create a new contact (person / lead). Routes through the public API so workflow triggers fire. " +
    "Optionally links the contact to a company by name. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview the resolved links. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    fullName: z.string().describe("Contact full name (e.g. 'Jane Doe')"),
    email: z.string().email().optional().describe("Primary email"),
    phone: z.string().optional().describe("Primary phone"),
    title: z.string().optional().describe("Job title (e.g. 'VP Engineering')"),
    companyName: z
      .string()
      .optional()
      .describe("Associated company name — fuzzy-matched locally; resolved companyId is linked after create"),
    ownerEmail: z.string().email().optional().describe("Internal owner email (arali user)"),
    stageKey: z.string().optional().describe("Contact lifecycle stage key (e.g. 'new_lead', 'qualified')"),
    customFields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Custom field values keyed by fieldKey"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, jwt } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    // Read-only resolution: companyName → companyId
    let resolvedCompany: { id: string; name: string } | null = null;
    if (input.companyName) {
      const hit = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(
          and(
            eq(companies.enterpriseId, enterpriseId),
            fuzzyNameMatch(companies.name, input.companyName),
          ),
        )
        .limit(1);
      if (!hit[0]) {
        return {
          success: false,
          message: `Company "${input.companyName}" not found. Omit companyName or create the company first.`,
        };
      }
      resolvedCompany = hit[0];
    }

    // Read-only resolution: ownerEmail → userId
    let resolvedOwner: { id: string; email: string } | null = null;
    if (input.ownerEmail) {
      const hit = await db
        .select({ id: appUser.id, email: appUser.email })
        .from(appUser)
        .where(eq(appUser.email, input.ownerEmail))
        .limit(1);
      if (!hit[0]) {
        return { success: false, message: `Owner "${input.ownerEmail}" not found.` };
      }
      resolvedOwner = hit[0];
    }

    if (!confirmed) {
      return {
        needsConfirmation: true,
        preview: {
          fullName: input.fullName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          title: input.title ?? null,
          company: resolvedCompany?.name ?? null,
          owner: resolvedOwner?.email ?? null,
          stageKey: input.stageKey ?? null,
          customFieldCount: Object.keys(input.customFields ?? {}).length,
        },
        message: `Create contact "${input.fullName}"${
          resolvedCompany ? ` at ${resolvedCompany.name}` : ""
        }?`,
      };
    }

    // Mutation: POST /api/v1/contacts — backend creates contact + publishes workflow.trigger
    const externalId = `ai_${randomUUID()}`;
    const createResp = await callBackendApi<ContactsPostResponse>({
      method: "POST",
      path: "/api/v1/contacts",
      body: {
        providerKey: "arali_ai",
        contacts: [
          {
            externalId,
            fullName: input.fullName,
            title: input.title,
            emails: input.email ? [{ email: input.email, isPrimary: true }] : [],
            phones: input.phone ? [{ phone: input.phone, isPrimary: true }] : [],
            ownerUserId: resolvedOwner?.id,
            stageKey: input.stageKey,
            properties: input.customFields ?? {},
          },
        ],
      },
      jwt,
    });

    if (!createResp.ok) {
      return { success: false, message: `Failed to create contact: ${createResp.error}` };
    }

    const result = createResp.data?.results?.[0];
    if (!result || result.status !== "success" || !result.contactId) {
      return {
        success: false,
        message: `Contact create did not succeed: ${result?.error ?? result?.reason ?? "unknown"}`,
      };
    }

    const contactId = result.contactId;

    // Optional follow-up: link contact → company via associations endpoint
    let linkedCompany: string | null = null;
    let linkError: string | null = null;
    if (resolvedCompany) {
      const assocResp = await callBackendApi({
        method: "POST",
        path: "/api/v1/associations",
        body: {
          providerKey: "arali_ai",
          associations: [
            {
              contactId,
              companyId: resolvedCompany.id,
              relation: "employee",
              isPrimary: true,
            },
          ],
        },
        jwt,
      });
      if (assocResp.ok) {
        linkedCompany = resolvedCompany.name;
      } else {
        linkError = assocResp.error;
      }
    }

    return {
      success: true,
      contactId,
      linkedCompany,
      linkWarning: linkError
        ? `Contact was created but company link failed: ${linkError}`
        : undefined,
      message: `Created contact "${input.fullName}"${linkedCompany ? ` linked to ${linkedCompany}` : ""}.`,
    };
  },
});
