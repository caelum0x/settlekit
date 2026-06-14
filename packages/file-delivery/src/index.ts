import { addDays, generateId, type FileAsset } from "@settlekit/common";

export interface SignedDownloadGrant {
  id: string;
  fileId: string;
  customerId: string;
  url: string;
  expiresAt: string;
  downloadsRemaining: number;
}

export function createDownloadGrant(file: FileAsset, customerId: string, signedUrl: string, now = new Date()): SignedDownloadGrant {
  return {
    id: generateId("deliveryAction"),
    fileId: file.id,
    customerId,
    url: signedUrl,
    expiresAt: addDays(now, 1).toISOString(),
    downloadsRemaining: 5,
  };
}

export function consumeDownload(grant: SignedDownloadGrant): SignedDownloadGrant {
  if (grant.downloadsRemaining <= 0) throw new RangeError("download limit exceeded");
  return { ...grant, downloadsRemaining: grant.downloadsRemaining - 1 };
}
