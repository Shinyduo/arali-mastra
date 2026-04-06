import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const alg = "HS256";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

export type JwtClaims = {
  sub: string;
  email: string;
  name?: string;
  phone?: string;
  provider?: "local" | "google" | "microsoft";
  emailVerified?: boolean;
  enterpriseId?: string;
  selectedEnterpriseId?: string;
  defaultOrgUnitId?: string;
  onboardingCompleted?: boolean;
};

export async function verifyJwt<T = JwtClaims>(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as T;
}
