import { sql, type SQL } from "drizzle-orm";
import { companies } from "../db/schema.js";
import type { AraliRuntimeContext } from "../mastra/context/types.js";
import type { PgColumn } from "drizzle-orm/pg-core";

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
 * Builds a WHERE clause fragment that scopes company access by role.
 * - admin: no extra filter (just enterpriseId)
 * - rep: only companies where user has active key_role_assignment
 * - manager: companies where assigned user is in manager's org unit hierarchy
 */
export function buildCompanyScopeFilter(
  role: AraliRuntimeContext["userRole"],
  userId: string,
  orgUnitIds: string[],
  companyIdColumn: PgColumn = companies.id,
): SQL | undefined {
  if (role === "admin") {
    return undefined;
  }

  if (role === "rep") {
    return sql`EXISTS (
      SELECT 1 FROM key_role_assignments kra
      WHERE kra.entity_type = 'company'
        AND kra.entity_id = ${companyIdColumn}
        AND kra.end_at IS NULL
        AND kra.user_id = ${userId}
    )`;
  }

  // manager: companies where assigned user is in the manager's org unit hierarchy
  if (orgUnitIds.length === 0) {
    // manager with no org units — fall back to self scope
    return sql`EXISTS (
      SELECT 1 FROM key_role_assignments kra
      WHERE kra.entity_type = 'company'
        AND kra.entity_id = ${companyIdColumn}
        AND kra.end_at IS NULL
        AND kra.user_id = ${userId}
    )`;
  }

  return sql`EXISTS (
    SELECT 1 FROM key_role_assignments kra
    JOIN user_org_unit uou ON uou.user_id = kra.user_id
    JOIN org_unit_closure ouc ON ouc.descendant_id = uou.org_unit_id
    WHERE kra.entity_type = 'company'
      AND kra.entity_id = ${companyIdColumn}
      AND kra.end_at IS NULL
      AND ouc.ancestor_id = ANY(${pgUuidArray(orgUnitIds)})
  )`;
}

/**
 * Builds a WHERE clause fragment for owner-scoped entities (e.g. action items).
 * - admin: no filter
 * - rep: ownerUserId = userId
 * - manager: ownerUserId IN users within org unit hierarchy
 */
export function buildOwnerScopeFilter(
  role: AraliRuntimeContext["userRole"],
  userId: string,
  orgUnitIds: string[],
  ownerColumn: PgColumn,
): SQL | undefined {
  if (role === "admin") {
    return undefined;
  }

  if (role === "rep") {
    return sql`${ownerColumn} = ${userId}`;
  }

  // manager
  if (orgUnitIds.length === 0) {
    return sql`${ownerColumn} = ${userId}`;
  }

  return sql`${ownerColumn} IN (
    SELECT uou.user_id FROM user_org_unit uou
    JOIN org_unit_closure ouc ON ouc.descendant_id = uou.org_unit_id
    WHERE ouc.ancestor_id = ANY(${orgUnitIds}::uuid[])
  )`;
}

/**
 * Fuzzy name match: splits input into words and requires ALL words to match
 * anywhere in the name (case-insensitive). Handles "flex car" matching "Flexcar",
 * "Flexi Car", "Carflex Auto LTD", etc.
 *
 * Works with both Drizzle columns and raw SQL column references.
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
    userRole: requestContext.get("userRole") as AraliRuntimeContext["userRole"],
  };
}
