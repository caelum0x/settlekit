import { generateId, type AgentService } from "@settlekit/common";

export function createAgentService(input: Omit<AgentService, "id" | "published" | "createdAt">, now = new Date()): AgentService {
  return { ...input, id: generateId("agentService"), published: false, createdAt: now.toISOString() };
}
