export interface IncidentAction {
  action: string;
  completedAt?: string;
}

export interface IncidentResponsePlan {
  incidentId: string;
  commanderId: string;
  actions: IncidentAction[];
  status: "open" | "mitigating" | "resolved";
}

export function startMitigation(plan: IncidentResponsePlan): IncidentResponsePlan {
  return { ...plan, status: "mitigating" };
}

export function resolveIncident(plan: IncidentResponsePlan, now = new Date()): IncidentResponsePlan {
  return { ...plan, status: "resolved", actions: plan.actions.map((action) => action.completedAt ? action : { ...action, completedAt: now.toISOString() }) };
}
