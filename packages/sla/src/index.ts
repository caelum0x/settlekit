export interface SlaPolicy {
  name: string;
  uptimeTargetPercent: number;
  responseTimeHours: number;
}

export interface IncidentWindow {
  downtimeMinutes: number;
  periodMinutes: number;
}

export function uptimePercent(window: IncidentWindow): number {
  if (window.periodMinutes <= 0) throw new RangeError("periodMinutes must be positive");
  return ((window.periodMinutes - window.downtimeMinutes) / window.periodMinutes) * 100;
}

export function slaBreached(policy: SlaPolicy, window: IncidentWindow): boolean {
  return uptimePercent(window) < policy.uptimeTargetPercent;
}
