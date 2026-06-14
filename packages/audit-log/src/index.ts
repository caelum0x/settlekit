import { generateId } from "@settlekit/common";

export type AuditActorType = "user" | "system" | "webhook" | "agent";

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function createAuditLogEntry(input: Omit<AuditLogEntry, "id" | "createdAt">, now = new Date()): AuditLogEntry {
  return { ...input, id: generateId("webhookEvent"), createdAt: now.toISOString() };
}

export function filterAuditLogByResource(entries: AuditLogEntry[], resourceType: string, resourceId: string): AuditLogEntry[] {
  return entries.filter((entry) => entry.resourceType === resourceType && entry.resourceId === resourceId);
}
