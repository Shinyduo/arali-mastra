import { db } from "../db/index.js";
import {
  permission,
  rolePermission,
  userRoleAssignment,
  userOrgUnit,
  orgUnitClosure,
} from "../db/schema.js";
import { eq, and, or, isNull } from "drizzle-orm";

/**
 * Scoped capability for a single resource-action pair.
 * Mirrors arali-main's ScopedCapability type.
 */
export type ScopedCapability = {
  enterprise: boolean;
  orgUnits: string[];
  self: boolean;
};

/**
 * Map of resource → action → scope.
 * e.g. { meeting: { read: { enterprise: false, orgUnits: ["ou-1"], self: true } } }
 */
export type ScopedCapabilityMap = Record<string, Record<string, ScopedCapability>>;

/**
 * Fetches the full capability map for a user in an enterprise.
 * Mirrors arali-main's getUserCapabilities() from iam.server.ts.
 *
 * Joins: userRoleAssignment → rolePermission → permission
 * LEFT JOINs orgUnitClosure to expand org unit hierarchy (descendants).
 */
export async function getUserCapabilities(
  userId: string,
  enterpriseId: string,
): Promise<ScopedCapabilityMap> {
  const rows = await db
    .select({
      resource: permission.resource,
      action: permission.action,
      scopeType: userRoleAssignment.scopeType,
      assignmentOrgUnitId: userRoleAssignment.orgUnitId,
      descendantOrgUnitId: orgUnitClosure.descendantId,
    })
    .from(userRoleAssignment)
    .innerJoin(rolePermission, eq(userRoleAssignment.roleId, rolePermission.roleId))
    .innerJoin(permission, eq(rolePermission.permissionId, permission.id))
    .leftJoin(orgUnitClosure, eq(userRoleAssignment.orgUnitId, orgUnitClosure.ancestorId))
    .where(
      and(
        eq(userRoleAssignment.userId, userId),
        or(
          eq(userRoleAssignment.enterpriseId, enterpriseId),
          isNull(userRoleAssignment.enterpriseId),
        ),
      ),
    );

  const capabilities: ScopedCapabilityMap = {};

  for (const row of rows) {
    const resource = row.resource;
    const action = row.action;

    if (!capabilities[resource]) capabilities[resource] = {};
    if (!capabilities[resource][action]) {
      capabilities[resource][action] = { enterprise: false, orgUnits: [], self: false };
    }

    const cap = capabilities[resource][action];

    if (row.scopeType === "enterprise") {
      cap.enterprise = true;
    } else if (row.scopeType === "org_unit") {
      // Add both the assigned org unit and all its descendants
      if (row.assignmentOrgUnitId && !cap.orgUnits.includes(row.assignmentOrgUnitId)) {
        cap.orgUnits.push(row.assignmentOrgUnitId);
      }
      if (row.descendantOrgUnitId && !cap.orgUnits.includes(row.descendantOrgUnitId)) {
        cap.orgUnits.push(row.descendantOrgUnitId);
      }
    } else if (row.scopeType === "self") {
      cap.self = true;
    }
  }

  return capabilities;
}

/**
 * Extract scope for a specific resource/action from capabilities.
 * Returns undefined if no permission exists.
 */
export function getScopeForResource(
  capabilities: ScopedCapabilityMap,
  resource: string,
  action: string,
): ScopedCapability | undefined {
  return capabilities[resource]?.[action];
}

/**
 * Fetch user's org unit IDs (for the requestContext, used by get-metrics etc.)
 */
export async function getUserOrgUnitIds(
  userId: string,
  enterpriseId: string,
): Promise<string[]> {
  const rows = await db
    .select({ orgUnitId: userOrgUnit.orgUnitId })
    .from(userOrgUnit)
    .where(
      and(
        eq(userOrgUnit.userId, userId),
        eq(userOrgUnit.enterpriseId, enterpriseId),
      ),
    );
  return rows.map((r) => r.orgUnitId);
}
