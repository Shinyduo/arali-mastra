import type { ScopedCapabilityMap } from "../../lib/resolve-user-role.js";

export type AraliRuntimeContext = {
  enterpriseId: string;
  userId: string;
  userName: string;
  userEmail: string;
  orgUnitIds: string[];
  capabilities: ScopedCapabilityMap;
};
