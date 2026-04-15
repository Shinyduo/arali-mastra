import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../../../db/index.js";
import { appUser } from "../../../db/schema.js";
import { eq } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";
import { callBackendApi } from "../../../lib/backend-api.js";

interface CompaniesPostResponse {
  success?: boolean;
  results?: Array<{
    externalId: string;
    externalCompanyId?: string | null;
    companyId?: string;
    status: "success" | "skipped" | "error";
    reason?: string;
    error?: string;
  }>;
}

export const createCompany = createTool({
  id: "create-company",
  description:
    "Create a new company. Routes through the public API so workflow triggers fire. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    name: z.string().describe("Company name (e.g. 'Acme Corp')"),
    domain: z.string().optional().describe("Website domain (e.g. 'acme.com')"),
    arr: z.number().optional().describe("Annual Recurring Revenue"),
    currency: z.string().optional().describe("ISO 4217 code (defaults to USD)"),
    stageKey: z
      .string()
      .optional()
      .describe("Company lifecycle stage key (e.g. 'prospect', 'active', 'churned')"),
    ownerEmail: z.string().email().optional().describe("Internal owner email (arali user)"),
    customFields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Custom field values keyed by fieldKey"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { jwt } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

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
          name: input.name,
          domain: input.domain ?? null,
          arr: input.arr ?? null,
          currency: input.currency ?? null,
          stageKey: input.stageKey ?? null,
          owner: resolvedOwner?.email ?? null,
          customFieldCount: Object.keys(input.customFields ?? {}).length,
        },
        message: `Create company "${input.name}"?`,
      };
    }

    // Mutation: POST /api/v1/companies — backend creates company + publishes workflow.trigger
    const externalId = `ai_${randomUUID()}`;
    const resp = await callBackendApi<CompaniesPostResponse>({
      method: "POST",
      path: "/api/v1/companies",
      body: {
        providerKey: "arali_ai",
        companies: [
          {
            externalId,
            name: input.name,
            domain: input.domain,
            arr: input.arr,
            currency: input.currency,
            stageKey: input.stageKey,
            ownerUserId: resolvedOwner?.id,
            properties: input.customFields ?? {},
          },
        ],
      },
      jwt,
    });

    if (!resp.ok) {
      return { success: false, message: `Failed to create company: ${resp.error}` };
    }

    const result = resp.data?.results?.[0];
    if (!result || result.status !== "success" || !result.companyId) {
      return {
        success: false,
        message: `Company create did not succeed: ${result?.error ?? result?.reason ?? "unknown"}`,
      };
    }

    return {
      success: true,
      companyId: result.companyId,
      message: `Created company "${input.name}".`,
    };
  },
});
