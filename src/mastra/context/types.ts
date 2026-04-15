import type { ScopedCapabilityMap } from "../../lib/resolve-user-role.js";

export type AraliRuntimeContext = {
  enterpriseId: string;
  userId: string;
  userName: string;
  userEmail: string;
  orgUnitIds: string[];
  capabilities: ScopedCapabilityMap;
  /**
   * Raw JWT from the incoming request, preserved so tools can forward it
   * to the arali-backend public API for mutations that need workflow triggers.
   */
  jwt: string;
};
