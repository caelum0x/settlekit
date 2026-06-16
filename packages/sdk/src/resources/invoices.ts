/**
 * Invoices resource client.
 *
 * Maps to `/v1/invoices`.
 */
import type { Money } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** A customer invoice as returned by the API. */
export interface Invoice {
  id: string;
  number: string;
  organizationId: string;
  customerId: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  currency: "USDC";
  total: Money;
  metadata: Record<string, string>;
}

/** A single invoice line item. */
export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unitAmount: string;
}

/** Input for {@link InvoicesResource.create}. */
export interface CreateInvoiceInput {
  organizationId: string;
  customerId: string;
  lineItems?: InvoiceLineItemInput[];
  discount?: string;
  dueAt?: string;
  metadata?: Record<string, string>;
}

/** Client for invoice endpoints. */
export class InvoicesResource {
  constructor(private readonly http: HttpClient) {}

  /** List invoices (optionally filtered by customer). */
  list(customerId?: string, options?: RequestOptions): Promise<Invoice[]> {
    const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
    return this.http.get<Invoice[]>(`/v1/invoices${qs}`, options);
  }

  /** Create a draft invoice. */
  create(input: CreateInvoiceInput, options?: RequestOptions): Promise<Invoice> {
    return this.http.post<Invoice>("/v1/invoices", input, options);
  }

  /** Retrieve an invoice by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Invoice> {
    return this.http.get<Invoice>(`/v1/invoices/${encodeURIComponent(id)}`, options);
  }

  /** Finalize a draft invoice (draft → open). */
  finalize(id: string, options?: RequestOptions): Promise<Invoice> {
    return this.http.post<Invoice>(`/v1/invoices/${encodeURIComponent(id)}/finalize`, undefined, options);
  }

  /** Mark an open invoice paid. */
  pay(id: string, options?: RequestOptions): Promise<Invoice> {
    return this.http.post<Invoice>(`/v1/invoices/${encodeURIComponent(id)}/pay`, undefined, options);
  }

  /** Void a draft or open invoice. */
  void(id: string, options?: RequestOptions): Promise<Invoice> {
    return this.http.post<Invoice>(`/v1/invoices/${encodeURIComponent(id)}/void`, undefined, options);
  }
}
