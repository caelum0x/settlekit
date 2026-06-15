import { generateSecret } from "@settlekit/common";

export interface ApiClient {
  id: string;
  name: string;
  scopes: string[];
  keyPrefix: string;
  status: "active" | "revoked";
}

export function createApiClient(id: string, name: string, scopes: string[]): { client: ApiClient; secret: string } {
  const secret = `sk_client_${generateSecret(24)}`;
  return { secret, client: { id, name, scopes, keyPrefix: secret.slice(0, 18), status: "active" } };
}

export function apiClientCan(client: ApiClient, scope: string): boolean {
  return client.status === "active" && client.scopes.includes(scope);
}

export function revokeApiClient(client: ApiClient): ApiClient {
  return { ...client, status: "revoked" };
}
