import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import {
  keyRoleAssignments,
  keyRoleDefinitions,
  companies,
  appUser,
} from "../../../db/schema.js";
import { eq, and, ilike, isNull } from "drizzle-orm";
import { extractContext } from "../../../lib/rbac.js";

export const assignKeyRole = createTool({
  id: "assign-key-role",
  description:
    "Assign a key role (CSM, AE, TAM, etc.) on a company to a user. " +
    "Ends the current assignment and creates a new one. Requires confirmation.",
  inputSchema: z.object({
    companyName: z.string().describe("Company name"),
    roleKey: z.string().describe("Role key (e.g. 'csm', 'ae', 'tam')"),
    newOwnerEmail: z
      .string()
      .email()
      .describe("Email of the user to assign the role to"),
  }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);

    if (context.agent?.resumeData != null) {
      try {
        const company = await db
          .select({ id: companies.id, name: companies.name })
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

        const roleDef = await db
          .select({ id: keyRoleDefinitions.id, name: keyRoleDefinitions.name })
          .from(keyRoleDefinitions)
          .where(
            and(
              eq(keyRoleDefinitions.enterpriseId, enterpriseId),
              eq(keyRoleDefinitions.key, input.roleKey),
            ),
          )
          .limit(1);

        if (!roleDef[0]) {
          return { success: false, message: `Role "${input.roleKey}" not found.` };
        }

        const newUser = await db
          .select({ id: appUser.id, name: appUser.name })
          .from(appUser)
          .where(eq(appUser.email, input.newOwnerEmail))
          .limit(1);

        if (!newUser[0]) {
          return { success: false, message: `User with email "${input.newOwnerEmail}" not found.` };
        }

        // End current assignment
        await db
          .update(keyRoleAssignments)
          .set({ endAt: new Date() })
          .where(
            and(
              eq(keyRoleAssignments.enterpriseId, enterpriseId),
              eq(keyRoleAssignments.keyRoleDefinitionId, roleDef[0].id),
              eq(keyRoleAssignments.entityType, "company"),
              eq(keyRoleAssignments.entityId, company[0].id),
              isNull(keyRoleAssignments.endAt),
            ),
          );

        // Create new assignment
        await db.insert(keyRoleAssignments).values({
          enterpriseId,
          keyRoleDefinitionId: roleDef[0].id,
          entityType: "company",
          entityId: company[0].id,
          userId: newUser[0].id,
          startAt: new Date(),
        });

        return {
          success: true,
          message: `${newUser[0].name} assigned as ${roleDef[0].name} for ${company[0].name}.`,
        };
      } catch (err: any) {
        return { success: false, message: `Failed: ${err.message}` };
      }
    }

    await context.agent?.suspend({
      action: "assign-key-role",
      summary: `Assign ${input.roleKey} role on "${input.companyName}" to ${input.newOwnerEmail}`,
    });
  },
});
