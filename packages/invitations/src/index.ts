import { addDays } from "@settlekit/common";

export interface Invitation {
  email: string;
  role: "owner" | "admin" | "member";
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
