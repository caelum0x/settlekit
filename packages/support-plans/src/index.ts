export interface SupportPlan {
  id: string;
  name: string;
  responseTimeHours: number;
  monthlyTicketLimit: number;
  channels: Array<"email" | "discord" | "github" | "office_hours">;
}

export interface SupportUsage {
  planId: string;
  ticketsUsed: number;
}

export function canOpenSupportTicket(plan: SupportPlan, usage: SupportUsage): boolean {
  return usage.planId === plan.id && usage.ticketsUsed < plan.monthlyTicketLimit;
}

export function supportSlaLabel(plan: SupportPlan): string {
  return `${plan.responseTimeHours}h response`;
}
