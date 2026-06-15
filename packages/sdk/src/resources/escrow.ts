/**
 * Escrow resource client. Maps to `/v1/escrow`.
 *
 * Milestone escrow lifecycle: create -> fund -> assign -> submit -> approve ->
 * release, with refund/dispute paths.
 */
import type { EscrowTask } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link EscrowResource.createTask}. */
export interface CreateEscrowTaskInput {
  organizationId: string;
  buyerCustomerId: string;
  title: string;
  description: string;
  amount: string;
  currency?: "USDC";
}

/** Client for escrow task endpoints. */
export class EscrowResource {
  constructor(private readonly http: HttpClient) {}

  /** Create an escrow task. */
  createTask(input: CreateEscrowTaskInput, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.post<EscrowTask>("/v1/escrow/tasks", input, options);
  }

  /** List escrow tasks for an organization. */
  listTasks(organizationId: string, options?: RequestOptions): Promise<EscrowTask[]> {
    return this.http.get<EscrowTask[]>("/v1/escrow/tasks", {
      ...options,
      query: { organizationId },
    });
  }

  /** Retrieve an escrow task by id. */
  retrieveTask(id: string, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.get<EscrowTask>(`/v1/escrow/tasks/${encodeURIComponent(id)}`, options);
  }

  /** Fund an escrow task with the on-chain funding transaction hash. */
  fund(id: string, fundingTxHash: string, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.post<EscrowTask>(
      `/v1/escrow/tasks/${encodeURIComponent(id)}/fund`,
      { fundingTxHash },
      options,
    );
  }

  /** Assign a worker to a funded task. */
  assign(id: string, workerCustomerId: string, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.post<EscrowTask>(
      `/v1/escrow/tasks/${encodeURIComponent(id)}/assign`,
      { workerCustomerId },
      options,
    );
  }

  /** Submit work for an assigned task. */
  submit(id: string, content: string, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.post<EscrowTask>(
      `/v1/escrow/tasks/${encodeURIComponent(id)}/submit`,
      { content },
      options,
    );
  }

  /** Approve submitted work. */
  approve(id: string, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.post<EscrowTask>(
      `/v1/escrow/tasks/${encodeURIComponent(id)}/approve`,
      undefined,
      options,
    );
  }

  /** Release escrowed funds with the on-chain release transaction hash. */
  release(id: string, releaseTxHash: string, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.post<EscrowTask>(
      `/v1/escrow/tasks/${encodeURIComponent(id)}/release`,
      { releaseTxHash },
      options,
    );
  }

  /** Refund an escrow task with an optional reason. */
  refund(id: string, reason?: string, options?: RequestOptions): Promise<EscrowTask> {
    return this.http.post<EscrowTask>(
      `/v1/escrow/tasks/${encodeURIComponent(id)}/refund`,
      reason !== undefined ? { reason } : {},
      options,
    );
  }
}
