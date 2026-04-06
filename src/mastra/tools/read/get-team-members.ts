import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { appUser, userEnterprise } from "../../../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const getTeamMembers = createTool({
  id: "get-team-members",
  description:
    "Look up team members in the organization by name. " +
    "Use this when the user refers to someone by first name (e.g. 'assign to Himanshu') " +
    "to resolve their full name and email before passing to other tools.",
  inputSchema: z.object({
    nameSearch: z
      .string()
      .describe("Name to search for (partial match, e.g. 'Himanshu')"),
  }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);

    const members = await db
      .select({
        name: appUser.name,
        email: appUser.email,
      })
      .from(appUser)
      .innerJoin(
        userEnterprise,
        and(
          eq(userEnterprise.userId, appUser.id),
          eq(userEnterprise.enterpriseId, enterpriseId),
        ),
      )
      .where(ilike(appUser.name, `%${input.nameSearch}%`))
      .limit(10);

    if (members.length === 0) {
      return { results: [], message: `No team member found matching "${input.nameSearch}".` };
    }

    return {
      results: members.map((m) => ({
        name: m.name,
        email: m.email,
      })),
    };
  },
});
