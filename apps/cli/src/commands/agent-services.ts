/**
 * `settlekit agent-services` — list and publish AI agent service listings.
 *
 *   list                 GET  /v1/agent-services
 *   publish <id>         POST /v1/agent-services/:id/publish
 *   metadata <id>        GET  /v1/agent-services/:id/metadata.json
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

interface AgentService extends Record<string, unknown> {
  id: string;
  name: string;
  price: string;
  network: string;
  status?: string;
}

export function registerAgentServices(program: Command): void {
  const agents = program.command("agent-services").description("List + publish AI agent services");

  agents
    .command("list")
    .description("List agent services")
    .action(async function (this: Command) {
      const ctx = buildContext(this);
      const rows = await ctx.client.get<AgentService[]>("/v1/agent-services");
      ctx.printList(rows, [
        { header: "ID", value: (a) => a.id },
        { header: "NAME", value: (a) => a.name },
        { header: "PRICE", value: (a) => a.price },
        { header: "NETWORK", value: (a) => a.network },
        { header: "STATUS", value: (a) => a.status },
      ]);
    });

  agents
    .command("publish <id>")
    .description("Publish an agent service")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const service = await ctx.client.post<AgentService>(
        `/v1/agent-services/${encodeURIComponent(id)}/publish`,
      );
      ctx.printRecord(service);
    });

  agents
    .command("metadata <id>")
    .description("Fetch the agent-readable metadata.json for a service")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const metadata = await ctx.client.get<Record<string, unknown>>(
        `/v1/agent-services/${encodeURIComponent(id)}/metadata.json`,
      );
      ctx.printRecord(metadata);
    });
}
