import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { toolInvocations } from "../../../db/schema.js";
import { extractContext } from "../../../lib/rbac.js";

export const submitFeedback = createTool({
  id: "submit-feedback",
  description:
    "Use this tool when you cannot answer the user's question because no existing tool covers it, " +
    "the data they need isn't available, or the request is outside your current capabilities. " +
    "This logs their query so the team can review gaps and build the missing capability. " +
    "Always tell the user you've logged their request before calling this tool.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The user's original question or request that could not be fulfilled"),
    reason: z
      .string()
      .describe("Brief explanation of why this couldn't be answered (e.g. 'no tool for pipeline forecasting', 'data not available in DB')"),
    category: z
      .enum(["missing_tool", "missing_data", "access_denied", "unclear_request", "other"])
      .optional()
      .describe("Category of the gap"),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId } = extractContext(context.requestContext!);

    await db.insert(toolInvocations).values({
      enterpriseId,
      userId,
      source: "feedback",
      toolId: "submit-feedback",
      input: input as Record<string, unknown>,
      status: "success",
      durationMs: 0,
    });

    return {
      success: true,
      message: "Feedback logged. The team will review this request.",
    };
  },
});
