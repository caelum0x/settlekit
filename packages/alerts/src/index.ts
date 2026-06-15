export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertRule {
  id: string;
  metric: string;
  threshold: number;
  severity: AlertSeverity;
  enabled: boolean;
}

export interface Alert {
  ruleId: string;
  metric: string;
  value: number;
  severity: AlertSeverity;
}

export function evaluateAlertRule(rule: AlertRule, value: number): Alert | undefined {
  if (!rule.enabled || value < rule.threshold) return undefined;
  return { ruleId: rule.id, metric: rule.metric, value, severity: rule.severity };
}

export function highestAlertSeverity(alerts: Alert[]): AlertSeverity | undefined {
  if (alerts.some((alert) => alert.severity === "critical")) return "critical";
  if (alerts.some((alert) => alert.severity === "warning")) return "warning";
  return alerts.length > 0 ? "info" : undefined;
}
