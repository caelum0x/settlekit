import { addDays } from "@settlekit/common";

export interface RetentionPolicy {
  resourceType: string;
  retainDays: number;
}

export function retentionExpiresAt(createdAt: string, policy: RetentionPolicy): string {
  return addDays(new Date(createdAt), policy.retainDays).toISOString();
}

export function shouldPurge(createdAt: string, policy: RetentionPolicy, now = new Date()): boolean {
  return new Date(retentionExpiresAt(createdAt, policy)).getTime() <= now.getTime();
}
