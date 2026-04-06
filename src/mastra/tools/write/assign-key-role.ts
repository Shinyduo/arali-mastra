import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { keyRoleAssignments, keyRoleDefinitions, companies, appUser } from "../../../db/schema.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { extractContext, fuzzyNameMatch } from "../../../lib/rbac.js";

export const assignKeyRole = createTool({
  id: "assign-key-role",
  description:
    "Assign a key role on a company to a user. " +
    "IMPORTANT: First call WITHOUT confirmed=true to preview and see available role keys for this enterprise. " +
    "Only set confirmed=true after user approves.",
  inputSchema: z.object({
    companyName: z.string().describe("Company name"),
    roleKey: z.string().describe("Role key — call without confirmed first to see available keys"),
    newOwnerEmail: z.string().email().describe("Email of the user to assign"),
    confirmed: z.boolean().optional().default(false).describe("Set true only after user confirms"),
  }),
  execute: async (input, context) => {
    const { enterpriseId } = extractContext(context.requestContext!);
    const confirmed = input.confirmed ?? false;

    // Fetch available role definitions: enterprise-specific override global defaults
    const allRoles = await db
      .select({
        key: keyRoleDefinitions.key,
        name: keyRoleDefinitions.name,
        enterpriseId: keyRoleDefinitions.enterpriseId,
      })
      .from(keyRoleDefinitions)
      .where(
        or(
          eq(keyRoleDefinitions.enterpriseId, enterpriseId),
          isNull(keyRoleDefinitions.enterpriseId),
        ),
      );

    // Dedupe: enterprise-specific wins over global
    const roleMap = new Map<string, { key: string; name: string }>();
    for (const r of allRoles) {
      if (!roleMap.has(r.key) || r.enterpriseId != null) {
        roleMap.set(r.key, { key: r.key, name: r.name });
      }
    }
    const availableRoles = Array.from(roleMap.values());

    if (!confirmed) {
      const validRole = availableRoles.find((r) => r.key === input.roleKey);
      return {
        needsConfirmation: true,
        message: `Assign ${validRole?.name ?? input.roleKey} on "${input.companyName}" to ${input.newOwnerEmail}?`,
        availableRoleKeys: availableRoles.map((r) => ({ key: r.key, name: r.name })),
        roleKeyValid: !!validRole,
      };
    }

    try {
      const company = await db.select({ id: companies.id, name: companies.name }).from(companies)
        .where(and(eq(companies.enterpriseId, enterpriseId), fuzzyNameMatch(companies.name, input.companyName))).limit(1);
      if (!company[0]) return { success: false, message: `Company "${input.companyName}" not found.` };

      const roleDef = availableRoles.find((r) => r.key === input.roleKey);
      if (!roleDef) {
        return {
          success: false,
          message: `Role "${input.roleKey}" not found.`,
          availableRoleKeys: availableRoles.map((r) => ({ key: r.key, name: r.name })),
        };
      }

      // Resolve role definition ID: prefer enterprise-specific, fall back to global
      const roleDefFull = await db.select({ id: keyRoleDefinitions.id, name: keyRoleDefinitions.name, eid: keyRoleDefinitions.enterpriseId }).from(keyRoleDefinitions)
        .where(and(
          or(eq(keyRoleDefinitions.enterpriseId, enterpriseId), isNull(keyRoleDefinitions.enterpriseId)),
          eq(keyRoleDefinitions.key, input.roleKey),
        ))
        .orderBy(keyRoleDefinitions.enterpriseId) // non-null (enterprise-specific) sorts first
        .limit(1);

      const newUser = await db.select({ id: appUser.id, name: appUser.name }).from(appUser)
        .where(eq(appUser.email, input.newOwnerEmail)).limit(1);
      if (!newUser[0]) return { success: false, message: `User "${input.newOwnerEmail}" not found.` };

      // End current assignment
      await db.update(keyRoleAssignments).set({ endAt: new Date() })
        .where(and(
          eq(keyRoleAssignments.enterpriseId, enterpriseId),
          eq(keyRoleAssignments.keyRoleDefinitionId, roleDefFull[0].id),
          eq(keyRoleAssignments.entityType, "company"),
          eq(keyRoleAssignments.entityId, company[0].id),
          isNull(keyRoleAssignments.endAt),
        ));

      // Create new assignment
      await db.insert(keyRoleAssignments).values({
        enterpriseId, keyRoleDefinitionId: roleDefFull[0].id,
        entityType: "company", entityId: company[0].id,
        userId: newUser[0].id, startAt: new Date(),
      });

      return { success: true, message: `${newUser[0].name} assigned as ${roleDefFull[0].name} for ${company[0].name}.` };
    } catch (err: any) {
      return { success: false, message: `Failed: ${err.message}` };
    }
  },
});
