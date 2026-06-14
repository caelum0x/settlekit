import type { AgentService } from "@settlekit/common";

export function discoverPublishedAgentServices(services: AgentService[]): AgentService[] {
  return services.filter((service) => service.published);
}
