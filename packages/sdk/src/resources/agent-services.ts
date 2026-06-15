/**
 * Agent services resource client. Maps to `/v1/agent-services`.
 */
import type { AgentService } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link AgentServicesResource.create}. */
export interface CreateAgentServiceInput {
  organizationId: string;
  merchantId: string;
  productId: string;
  name: string;
  description: string;
  endpoint: string;
  price: string;
  network?: "arc" | "base";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/** Input for {@link AgentServicesResource.update}. */
export interface UpdateAgentServiceInput {
  name?: string;
  description?: string;
  endpoint?: string;
  price?: string;
}

/** Query options for {@link AgentServicesResource.list}. */
export interface ListAgentServicesParams {
  organizationId?: string;
}

/** Client for agent service endpoints. */
export class AgentServicesResource {
  constructor(private readonly http: HttpClient) {}

  /** Create an agent service listing. */
  create(input: CreateAgentServiceInput, options?: RequestOptions): Promise<AgentService> {
    return this.http.post<AgentService>("/v1/agent-services", input, options);
  }

  /** Discover agent services, optionally filtered by organization. */
  list(params: ListAgentServicesParams = {}, options?: RequestOptions): Promise<AgentService[]> {
    return this.http.get<AgentService[]>("/v1/agent-services", {
      ...options,
      query: { ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}) },
    });
  }

  /** Retrieve an agent service by id. */
  retrieve(id: string, options?: RequestOptions): Promise<AgentService> {
    return this.http.get<AgentService>(`/v1/agent-services/${encodeURIComponent(id)}`, options);
  }

  /** Patch mutable agent service fields. */
  update(id: string, input: UpdateAgentServiceInput, options?: RequestOptions): Promise<AgentService> {
    return this.http.patch<AgentService>(`/v1/agent-services/${encodeURIComponent(id)}`, input, options);
  }

  /** Publish an agent service. */
  publish(id: string, options?: RequestOptions): Promise<AgentService> {
    return this.http.post<AgentService>(`/v1/agent-services/${encodeURIComponent(id)}/publish`, undefined, options);
  }

  /** Fetch the machine-readable metadata document (raw JSON, not enveloped). */
  metadata(id: string, options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      `/v1/agent-services/${encodeURIComponent(id)}/metadata.json`,
      options,
    );
  }
}
