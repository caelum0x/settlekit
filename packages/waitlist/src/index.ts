export interface WaitlistEntry {
  email: string;
  source: string;
  status: "waiting" | "invited" | "converted";
  createdAt: string;
}

export function joinWaitlist(email: string, source: string, now = new Date()): WaitlistEntry {
  return { email: email.toLowerCase(), source, status: "waiting", createdAt: now.toISOString() };
}

export function inviteWaitlistEntry(entry: WaitlistEntry): WaitlistEntry {
  return { ...entry, status: "invited" };
}

export function waitlistPosition(entries: WaitlistEntry[], email: string): number | undefined {
  const index = entries.findIndex((entry) => entry.email === email.toLowerCase() && entry.status === "waiting");
  return index === -1 ? undefined : index + 1;
}
