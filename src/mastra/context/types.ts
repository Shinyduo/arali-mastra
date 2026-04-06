export type AraliRuntimeContext = {
  enterpriseId: string;
  userId: string;
  userName: string;
  userEmail: string;
  orgUnitIds: string[];
  userRole: "admin" | "manager" | "rep";
};
