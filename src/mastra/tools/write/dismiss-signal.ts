import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { companySignal, companies } from "../../../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const dismissSignal = createTool({
  id: "dismiss-signal",
  description:
    "Dismiss an open company signal. Requires confirmation. " +
    "Provide the company name and signal title to identify it.",
  inputSchema: z.object({
    companyName: z.string().describe("Company the signal belongs to"),
    signalTitle: z.string().describe("Signal title (partial match)"),
  }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);

    if (context.agent?.resumeData != null) {
      try {
        const signals = await db
          .select({
            id: companySignal.id,
            title: companySignal.title,
            companyName: companies.name,
          })
          .from(companySignal)
          .innerJoin(companies, eq(companySignal.companyId, companies.id))
          .where(
            and(
              eq(companySignal.enterpriseId, enterpriseId),
              ilike(companies.name, `%${input.companyName}%`),
              ilike(companySignal.title, `%${input.signalTitle}%`),
              eq(companySignal.status, "open"),
            ),
          )
          .limit(1);

        if (!signals[0]) {
          return { success: false, message: "No matching open signal found." };
        }

        await db
          .update(companySignal)
          .set({
            status: "dismissed",
            dismissedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(companySignal.id, signals[0].id));

        return {
          success: true,
          message: `Signal "${signals[0].title}" for ${signals[0].companyName} dismissed.`,
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}` };
      }
    }

    await context.agent?.suspend({
      action: "dismiss-signal",
      summary: `Dismiss signal "${input.signalTitle}" for ${input.companyName}`,
    });
  },
});
