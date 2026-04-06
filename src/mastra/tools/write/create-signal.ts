import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  companySignal,
  companySignalOccurrence,
  companies,
} from "../../../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";
import { createHash } from "crypto";

export const createSignal = createTool({
  id: "create-signal",
  description:
    "Create a new company signal (risk, opportunity, or info alert). Requires confirmation. " +
    "Signals are deduped by company + category + title.",
  inputSchema: z.object({
    companyName: z.string().describe("Company to attach the signal to"),
    type: z
      .enum(["risk", "opportunity", "info"])
      .describe("Signal type"),
    categoryKey: z
      .string()
      .describe("Category key (e.g. 'churn', 'expansion_rollout', 'contraction_seats')"),
    title: z.string().describe("Signal title"),
    severity: z
      .enum(["low", "medium", "high", "critical"])
      .optional()
      .default("medium"),
  }),
  suspendSchema: z.object({
    action: z.literal("create-signal"),
    summary: z.string(),
  }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async (input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);

    if (context.agent?.resumeData) {
      const resume = context.agent.resumeData as { approved: boolean };
      if (!resume.approved) {
        return { success: false, message: "Signal creation cancelled." };
      }

      const company = await db
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            eq(companies.enterpriseId, enterpriseId),
            ilike(companies.name, `%${input.companyName}%`),
          ),
        )
        .limit(1);

      if (!company[0]) {
        return { success: false, message: `Company "${input.companyName}" not found.` };
      }

      // Deterministic dedupe key
      const dedupeKey = createHash("sha256")
        .update(`${company[0].id}:${input.categoryKey}:${input.title}`)
        .digest("hex")
        .slice(0, 32);

      const [signal] = await db
        .insert(companySignal)
        .values({
          enterpriseId,
          companyId: company[0].id,
          type: input.type,
          categoryKey: input.categoryKey,
          title: input.title,
          severity: input.severity ?? "medium",
          ownerUserId: userId,
          dedupeKey,
        })
        .onConflictDoUpdate({
          target: [companySignal.enterpriseId, companySignal.dedupeKey],
          set: { lastSeenAt: new Date(), updatedAt: new Date() },
        })
        .returning({ id: companySignal.id });

      if (signal) {
        await db.insert(companySignalOccurrence).values({
          enterpriseId,
          signalId: signal.id,
          source: "manual",
          triggerType: "user_created",
        });
      }

      return {
        success: true,
        message: `Signal "${input.title}" created for ${input.companyName}.`,
      };
    }

    await context.agent?.suspend({
      action: "create-signal",
      summary: `Create ${input.type} signal "${input.title}" (${input.severity ?? "medium"}) for ${input.companyName}, category: ${input.categoryKey}`,
    });

    return { success: false, message: "Awaiting confirmation." };
  },
});
