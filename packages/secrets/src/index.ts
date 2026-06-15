import { generateSecret } from "@settlekit/common";

export interface SecretReference {
  ref: string;
  version: number;
  createdAt: string;
}

export function createSecretReference(prefix: string, now = new Date()): { reference: SecretReference; plaintext: string } {
  const plaintext = generateSecret(32);
  return { plaintext, reference: { ref: `${prefix}_${plaintext.slice(0, 8)}`, version: 1, createdAt: now.toISOString() } };
}

export function rotateSecretReference(reference: SecretReference, now = new Date()): SecretReference {
  return { ...reference, version: reference.version + 1, createdAt: now.toISOString() };
}
