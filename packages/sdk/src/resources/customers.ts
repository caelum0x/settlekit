/**
 * Customers resource client. Maps to `/v1/customers`.
 */
import type { Customer } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link CustomersResource.create}. */
export interface CreateCustomerInput {
  organizationId: string;
  email: string;
  name?: string;
  walletAddress?: string;
  githubUsername?: string;
  discordUserId?: string;
  metadata?: Record<string, unknown>;
}

/** Client for customer endpoints. */
export class CustomersResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a customer. */
  create(input: CreateCustomerInput, options?: RequestOptions): Promise<Customer> {
    return this.http.post<Customer>("/v1/customers", input, options);
  }

  /** List customers. */
  list(options?: RequestOptions): Promise<Customer[]> {
    return this.http.get<Customer[]>("/v1/customers", options);
  }

  /** Retrieve a customer by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Customer> {
    return this.http.get<Customer>(`/v1/customers/${encodeURIComponent(id)}`, options);
  }
}
