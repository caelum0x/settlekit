package settlekit

import (
	"context"
	"net/http"
)

// InvoiceLineItemInput is a line item supplied when creating an invoice.
type InvoiceLineItemInput struct {
	Description string `json:"description"`
	Quantity    int    `json:"quantity"`
	UnitAmount  string `json:"unitAmount"`
}

// InvoiceTaxRate describes a tax rate applied to an invoice's taxable base.
type InvoiceTaxRate struct {
	Jurisdiction string `json:"jurisdiction"`
	RateBps      int    `json:"rateBps"`
	Inclusive    bool   `json:"inclusive,omitempty"`
}

// CreateInvoiceInput is the body for CreateInvoice (POST /v1/invoices).
type CreateInvoiceInput struct {
	OrganizationID string                 `json:"organizationId"`
	CustomerID     string                 `json:"customerId"`
	LineItems      []InvoiceLineItemInput `json:"lineItems,omitempty"`
	Discount       string                 `json:"discount,omitempty"`
	TaxRate        *InvoiceTaxRate        `json:"taxRate,omitempty"`
	DueAt          string                 `json:"dueAt,omitempty"`
	Metadata       map[string]string      `json:"metadata,omitempty"`
}

// CreateInvoice creates a draft invoice. POST /v1/invoices.
func (c *Client) CreateInvoice(ctx context.Context, in CreateInvoiceInput) (*Invoice, error) {
	var out Invoice
	if err := c.do(ctx, http.MethodPost, "/v1/invoices", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListInvoices lists invoices, optionally filtered by customer id (pass "" for
// all). GET /v1/invoices[?customerId=].
func (c *Client) ListInvoices(ctx context.Context, customerID string) ([]Invoice, error) {
	q := newQuery()
	q.add("customerId", customerID)
	var out []Invoice
	if err := c.do(ctx, http.MethodGet, "/v1/invoices"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetInvoice fetches an invoice by id. GET /v1/invoices/:id.
func (c *Client) GetInvoice(ctx context.Context, id string) (*Invoice, error) {
	var out Invoice
	if err := c.do(ctx, http.MethodGet, "/v1/invoices/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FinalizeInvoice transitions a draft invoice to open.
// POST /v1/invoices/:id/finalize.
func (c *Client) FinalizeInvoice(ctx context.Context, id string) (*Invoice, error) {
	var out Invoice
	if err := c.do(ctx, http.MethodPost, "/v1/invoices/"+id+"/finalize", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PayInvoice marks an open invoice as paid. POST /v1/invoices/:id/pay.
func (c *Client) PayInvoice(ctx context.Context, id string) (*Invoice, error) {
	var out Invoice
	if err := c.do(ctx, http.MethodPost, "/v1/invoices/"+id+"/pay", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// VoidInvoice voids a draft or open invoice. POST /v1/invoices/:id/void.
func (c *Client) VoidInvoice(ctx context.Context, id string) (*Invoice, error) {
	var out Invoice
	if err := c.do(ctx, http.MethodPost, "/v1/invoices/"+id+"/void", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
