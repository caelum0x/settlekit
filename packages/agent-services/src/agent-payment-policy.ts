export interface AgentPaymentPolicy {
  serviceId: string;
  requireX402: boolean;
  maxPriceUsdc?: string;
}
