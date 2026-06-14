import { addDays, generateSecret } from "@settlekit/common";

export interface PackageAccessToken {
  packageName: string;
  customerId: string;
  token: string;
  expiresAt: string;
  status: "active" | "revoked";
}

export function issuePackageAccessToken(packageName: string, customerId: string, now = new Date()): PackageAccessToken {
  return { packageName, customerId, token: `sk_pkg_${generateSecret(24)}`, expiresAt: addDays(now, 30).toISOString(), status: "active" };
}

export function revokePackageAccessToken(token: PackageAccessToken): PackageAccessToken {
  return { ...token, status: "revoked" };
}
