import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companySignal, companySignalOccurrence, companies } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";
import { createHash } from "crypto";

export const createSignal = createTool({
  id: "create-signal",
  description:
    "Create a new company signal (risk, opportunity, or info alert). " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    companyName: z.string().describe("Company to attach the signal to"),
    type: z.enum(["risk", "opportunity", "info"]).describe("Signal type"),
    categoryKey: z.string().describe("Category key (e.g. 'churn', 'expansion_rollout')"),
    title: z.string().describe("Signal title"),
    severity: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    if (!confirmed) {
      return {
        needsConfirmation: true,
        message: `Create ${input.type} signal "${input.title}" (${input.severity ?? "medium"}) for ${input.companyName}?`,
      };
    }

    try {
      const company = await db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.enterpriseId, enterpriseId), fuzzyNameMatch(companies.name, input.companyName)))
        .limit(1);

      if (!company[0]) return { success: false, message: `Company "${input.companyName}" not found.` };

      const dedupeKey = createHash("sha256")
        .update(`${company[0].id}:${input.categoryKey}:${input.title}`)
        .digest("hex").slice(0, 32);

      const [signal] = await db
        .insert(companySignal)
        .values({
          enterpriseId, companyId: company[0].id, type: input.type,
          categoryKey: input.categoryKey, title: input.title,
          severity: input.severity ?? "medium", ownerUserId: userId, dedupeKey,
        })
        .onConflictDoUpdate({
          target: [companySignal.enterpriseId, companySignal.dedupeKey],
          set: { lastSeenAt: new Date(), updatedAt: new Date() },
        })
        .returning({ id: companySignal.id });

      if (signal) {
        await db.insert(companySignalOccurrence).values({
          enterpriseId, signalId: signal.id, source: "manual", triggerType: "user_created",
        });
      }

      return { success: true, message: `Signal "${input.title}" created for ${input.companyName}.` };
    } catch (err: any) {
      return { success: false, message: `Failed: ${err.message}` };
    }
  },
});
