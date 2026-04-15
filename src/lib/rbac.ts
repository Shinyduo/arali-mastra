import { sql, type SQL } from "drizzle-orm";
import { companies } from "../db/schema.js";
import type { AraliRuntimeContext } from "../mastra/context/types.js";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { ScopedCapability, ScopedCapabilityMap } from "./resolve-user-role.js";
import { getScopeForResource } from "./resolve-user-role.js";

/**
 * Build a safe Postgres array literal from a string array: '{uuid1,uuid2}'
 * Returns '{}' for empty arrays so ANY() returns false.
 */
export function pgUuidArray(ids: string[]): ReturnType<typeof sql> {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  const safe = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (safe.length === 0) return sql`'{}'::uuid[]`;
  return sql.raw(`'{${safe.join(",")}}'::uuid[]`);
}

/**
 * Builds a WHERE clause fragment for key-role-scoped entities (companies, accounts).
 * Mirrors arali-main's buildKeyRoleScopeClause() from authorization.ts.
 *
 * - enterprise scope: no filter (returns undefined)
 * - org-unit scope: EXISTS with key_role_assignments + user_org_unit + org_unit_closure
 * - self scope: EXISTS with key_role_assignments where user_id = current user
 * - org-unit + self: combined with OR
 * - no scope: returns FALSE (deny all)
 */
export function buildKeyRoleScopeClause(
  scope: ScopedCapability | undefined,
  userId: string,
  entityType: "company" | "account",
  entityIdColumn: PgColumn | ReturnType<typeof sql> = companies.id,
): SQL | undefined {
  if (!scope) {
    // No permission at all — deny
    return sql`FALSE`;
  }

  if (scope.enterprise) {
    // Enterprise-wide access — no filter needed
    return undefined;
  }

  const parts: SQL[] = [];

  // Org-unit scope: entities where an assigned user is in the permitted org units
  if (scope.orgUnits.length > 0) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM key_role_assignments kra_scope
      JOIN user_org_unit uou_scope ON uou_scope.user_id = kra_scope.user_id
      JOIN org_unit_closure ouc_scope ON ouc_scope.descendant_id = uou_scope.org_unit_id
      WHERE kra_scope.entity_type = ${entityType}
        AND kra_scope.entity_id = ${entityIdColumn}
        AND kra_scope.end_at IS NULL
        AND ouc_scope.ancestor_id = ANY(${pgUuidArray(scope.orgUnits)})
    )`);
  }

  // Self scope: entities where current user is directly assigned
  if (scope.self) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM key_role_assignments kra_self
      WHERE kra_self.entity_type = ${entityType}
        AND kra_self.entity_id = ${entityIdColumn}
        AND kra_self.end_at IS NULL
        AND kra_self.user_id = ${userId}
    )`);
  }

  if (parts.length === 0) {
    return sql`FALSE`;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  // Combine org-unit + self with OR
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Contact scope clause — similar to company but uses slightly different end_at logic.
 * Mirrors arali-main's buildContactScopeClause().
 */
export function buildContactScopeClause(
  scope: ScopedCapability | undefined,
  userId: string,
  entityIdColumn: PgColumn | ReturnType<typeof sql>,
): SQL | undefined {
  if (!scope) return sql`FALSE`;
  if (scope.enterprise) return undefined;

  const parts: SQL[] = [];

  if (scope.orgUnits.length > 0) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM key_role_assignments kra_scope
      JOIN user_org_unit uou_scope ON uou_scope.user_id = kra_scope.user_id
      JOIN org_unit_closure ouc_scope ON ouc_scope.descendant_id = uou_scope.org_unit_id
      WHERE kra_scope.entity_type IN ('contact', 'contacts')
        AND kra_scope.entity_id = ${entityIdColumn}
        AND (kra_scope.end_at IS NULL OR kra_scope.end_at > NOW())
        AND ouc_scope.ancestor_id = ANY(${pgUuidArray(scope.orgUnits)})
    )`);
  }

  if (scope.self) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM key_role_assignments kra_self
      WHERE kra_self.entity_type IN ('contact', 'contacts')
        AND kra_self.entity_id = ${entityIdColumn}
        AND (kra_self.end_at IS NULL OR kra_self.end_at > NOW())
        AND kra_self.user_id = ${userId}
    )`);
  }

  if (parts.length === 0) return sql`FALSE`;
  if (parts.length === 1) return parts[0];
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Owner-based scope filter for entities with ownerUserId (e.g. action items).
 */
export function buildOwnerScopeFilter(
  scope: ScopedCapability | undefined,
  userId: string,
  ownerColumn: PgColumn,
): SQL | undefined {
  if (!scope) return sql`FALSE`;
  if (scope.enterprise) return undefined;

  const parts: SQL[] = [];

  if (scope.orgUnits.length > 0) {
    parts.push(sql`${ownerColumn} IN (
      SELECT uou.user_id FROM user_org_unit uou
      JOIN org_unit_closure ouc ON ouc.descendant_id = uou.org_unit_id
      WHERE ouc.ancestor_id = ANY(${pgUuidArray(scope.orgUnits)})
    )`);
  }

  if (scope.self) {
    parts.push(sql`${ownerColumn} = ${userId}`);
  }

  if (parts.length === 0) return sql`FALSE`;
  if (parts.length === 1) return parts[0];
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Fuzzy name match: splits input into words and requires ALL words to match
 * anywhere in the name (case-insensitive).
 */
export function fuzzyNameMatch(column: any, search: string): SQL {
  const words = search.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return sql`${column} ILIKE ${"%" + search + "%"}`;
  }
  const conditions = words.map((w) => sql`${column} ILIKE ${"%" + w + "%"}`);
  return sql`(${sql.join(conditions, sql` AND `)})`;
}

/**
 * Helper to extract AraliRuntimeContext values from Mastra's RequestContext.
 */
export function extractContext(requestContext: {
  get: (key: string) => unknown;
}): AraliRuntimeContext {
  return {
    enterpriseId: requestContext.get("enterpriseId") as string,
    userId: requestContext.get("userId") as string,
    userName: requestContext.get("userName") as string,
    userEmail: requestContext.get("userEmail") as string,
    orgUnitIds: (requestContext.get("orgUnitIds") as string[]) ?? [],
    capabilities: (requestContext.get("capabilities") as ScopedCapabilityMap) ?? {},
    jwt: (requestContext.get("jwt") as string) ?? "",
  };
}

/**
 * Convenience: get the company scope for a user.
 * Companies use "meeting.read" permission (matching arali-main).
 */
export function getCompanyScope(capabilities: ScopedCapabilityMap): ScopedCapability | undefined {
  return getScopeForResource(capabilities, "meeting", "read");
}

/**
 * Convenience: check if user has write access.
 * Write tools require "meeting.create" or similar.
 */
export function hasWriteAccess(capabilities: ScopedCapabilityMap): boolean {
  const scope = getScopeForResource(capabilities, "meeting", "create");
  return !!scope && (scope.enterprise || scope.orgUnits.length > 0 || scope.self);
}
