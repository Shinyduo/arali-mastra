import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companySignal, companies } from "../../../db/schema.js";
import { eq, and, ilike, inArray } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";

export const dismissSignal = createTool({
  id: "dismiss-signal",
  description:
    "Dismiss an open company signal. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview. Only set confirmed=true after user approves.",
  inputSchema: z.object({
    companyName: z.string().describe("Company the signal belongs to"),
    signalTitle: z.string().describe("Signal title (partial match)"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    if (!confirmed) {
      return { needsConfirmation: true, message: `Dismiss signal "${input.signalTitle}" for ${input.companyName}?` };
    }

    try {
      const signals = await db
        .select({ id: companySignal.id, title: companySignal.title, companyName: companies.name })
        .from(companySignal)
        .innerJoin(companies, eq(companySignal.companyId, companies.id))
        .where(and(
          eq(companySignal.enterpriseId, enterpriseId),
          fuzzyNameMatch(companies.name, input.companyName),
          ilike(companySignal.title, `%${input.signalTitle}%`),
          inArray(companySignal.status, ["open", "in_progress"]),
        ))
        .limit(1);

      if (!signals[0]) return { success: false, message: "No matching open/in-progress signal found." };

      await db.update(companySignal)
        .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
        .where(eq(companySignal.id, signals[0].id));

      return { success: true, message: `Signal "${signals[0].title}" for ${signals[0].companyName} dismissed.` };
    } catch (err: any) {
      return { success: false, message: `Failed: ${err.message}` };
    }
  },
});
