/**
 * Fresh Circle entity-secret ciphertext per request.
 *
 * Circle rejects a reused ciphertext, so each mutating DCW call needs the
 * 32-byte entity secret RSA-OAEP(SHA-256) encrypted anew with the entity's
 * public key (GET /v1/w3s/config/entity/publicKey). OAEP is randomized, so
 * every call yields a distinct ciphertext. The public key is fetched once.
 */
import { constants, publicEncrypt } from "node:crypto";
import type { WalletsHttp } from "@settlekit/circle-wallets";

const PUBLIC_KEY_PATH = "/v1/w3s/config/entity/publicKey";

export class EntitySecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitySecretError";
  }
}

export function encryptEntitySecret(entitySecretHex: string, publicKeyPem: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(entitySecretHex)) {
    throw new EntitySecretError("entity secret must be 32 bytes of hex");
  }
  return publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(entitySecretHex, "hex"),
  ).toString("base64");
}

/** Build an `entitySecretProvider` for `createWalletsClient`. */
export function createEntitySecretProvider(http: WalletsHttp, entitySecretHex: string): () => Promise<string> {
  let publicKey: Promise<string> | null = null;
  const loadKey = async (): Promise<string> => {
    const res = await http.request({ method: "GET", path: PUBLIC_KEY_PATH });
    const key = (res.body as { data?: { publicKey?: unknown } } | null)?.data?.publicKey;
    if (res.status >= 400 || typeof key !== "string") {
      throw new EntitySecretError(`could not fetch Circle entity public key (status ${res.status})`);
    }
    return key;
  };
  return async () => {
    if (!publicKey) {
      publicKey = loadKey().catch((error: unknown) => {
        publicKey = null;
        throw error;
      });
    }
    return encryptEntitySecret(entitySecretHex, await publicKey);
  };
}
