import { db } from "../db/index.js";
import { role, userRoleAssignment, userOrgUnit } from "../db/schema.js";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import type { AraliRuntimeContext } from "../mastra/context/types.js";

const ROLE_MAP: Record<string, AraliRuntimeContext["userRole"]> = {
  owner: "admin",
  admin: "admin",
  manager: "manager",
  member: "rep",
  viewer: "rep",
};

export async function resolveUserRole(
  userId: string,
  enterpriseId: string,
): Promise<{
  role: AraliRuntimeContext["userRole"];
  orgUnitIds: string[];
}> {
  const [assignments, orgUnits] = await Promise.all([
    db
      .select({
        roleKey: role.key,
        priority: role.priority,
      })
      .from(userRoleAssignment)
      .innerJoin(role, eq(userRoleAssignment.roleId, role.id))
      .where(
        and(
          eq(userRoleAssignment.userId, userId),
          or(
            eq(userRoleAssignment.enterpriseId, enterpriseId),
            isNull(userRoleAssignment.enterpriseId),
          ),
        ),
      )
      .orderBy(desc(role.priority))
      .limit(1),

    db
      .select({ orgUnitId: userOrgUnit.orgUnitId })
      .from(userOrgUnit)
      .where(
        and(
          eq(userOrgUnit.userId, userId),
          eq(userOrgUnit.enterpriseId, enterpriseId),
        ),
      ),
  ]);

  const topRole = assignments[0];
  const resolvedRole: AraliRuntimeContext["userRole"] =
    topRole ? (ROLE_MAP[topRole.roleKey] ?? "rep") : "rep";

  return {
    role: resolvedRole,
    orgUnitIds: orgUnits.map((o) => o.orgUnitId),
  };
}
