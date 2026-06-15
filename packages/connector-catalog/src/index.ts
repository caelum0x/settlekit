export type ConnectorCategory = "payments" | "access" | "community" | "storage" | "analytics" | "support";

export interface ConnectorDefinition {
  key: string;
  name: string;
  category: ConnectorCategory;
  requiredSecrets: string[];
  enabled: boolean;
}

export function enabledConnectors(connectors: ConnectorDefinition[]): ConnectorDefinition[] {
  return connectors.filter((connector) => connector.enabled);
}

export function connectorReady(connector: ConnectorDefinition, availableSecrets: string[]): boolean {
  return connector.requiredSecrets.every((secret) => availableSecrets.includes(secret));
}
