import { addDays } from "@settlekit/common";

/** Team roles an invitation can grant ("member" kept for older callers). */
export type InvitationRole = "owner" | "admin" | "developer" | "support" | "viewer" | "member";

export interface Invitation {
  email: string;
  role: InvitationRole;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
}

export function createInvitation(input: Omit<Invitation, "status" | "expiresAt">, now = new Date()): Invitation {
  return { ...input, email: input.email.toLowerCase(), status: "pending", expiresAt: addDays(now, 7).toISOString() };
}

export function acceptInvitation(invitation: Invitation, now = new Date()): Invitation {
  if (new Date(invitation.expiresAt).getTime() < now.getTime()) return { ...invitation, status: "expired" };
  return { ...invitation, status: "accepted" };
}

/** Revoke a pending invitation (accepted ones stay accepted). */
export function revokeInvitation(invitation: Invitation): Invitation {
  return invitation.status === "pending" ? { ...invitation, status: "revoked" } : invitation;
}

/** Whether an invitation can still be accepted at `now`. */
export function isInvitationOpen(invitation: Pick<Invitation, "status" | "expiresAt">, now = new Date()): boolean {
  return invitation.status === "pending" && new Date(invitation.expiresAt).getTime() >= now.getTime();
}
