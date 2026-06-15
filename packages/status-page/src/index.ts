export type ComponentStatus = "operational" | "degraded" | "partial_outage" | "major_outage";

export interface StatusComponent {
  name: string;
  status: ComponentStatus;
}

export interface StatusIncident {
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  createdAt: string;
}

export function overallStatus(components: StatusComponent[]): ComponentStatus {
  if (components.some((component) => component.status === "major_outage")) return "major_outage";
  if (components.some((component) => component.status === "partial_outage")) return "partial_outage";
  if (components.some((component) => component.status === "degraded")) return "degraded";
  return "operational";
}

export function createIncident(title: string, now = new Date()): StatusIncident {
  return { title, status: "investigating", createdAt: now.toISOString() };
}
