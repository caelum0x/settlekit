package settlekit

import (
	"context"
	"net/http"
)

// DisputeEvidence is a single piece of evidence attached to a dispute.
type DisputeEvidence struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
	Value       string `json:"value"`
	SubmittedAt string `json:"submittedAt"`
}

// Dispute is a dispute opened against a confirmed payment.
type Dispute struct {
	ID         string            `json:"id"`
	PaymentID  string            `json:"paymentId"`
	CustomerID string            `json:"customerId"`
	Reason     string            `json:"reason"`
	Status     string            `json:"status"`
	Evidence   []DisputeEvidence `json:"evidence"`
	OpenedAt   string            `json:"openedAt"`
	UpdatedAt  string            `json:"updatedAt"`
	ResolvedAt string            `json:"resolvedAt,omitempty"`
}

// OpenDisputeInput is the body for OpenDispute (POST /v1/disputes). Reason is
// one of: "fraud", "not_received", "duplicate", "quality", "unrecognized".
type OpenDisputeInput struct {
	PaymentID  string `json:"paymentId"`
	CustomerID string `json:"customerId"`
	Reason     string `json:"reason"`
}

// OpenDispute opens a dispute against a payment. POST /v1/disputes.
func (c *Client) OpenDispute(ctx context.Context, in OpenDisputeInput) (*Dispute, error) {
	var out Dispute
	if err := c.do(ctx, http.MethodPost, "/v1/disputes", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListDisputes lists disputes, optionally filtered by status (pass "" for all).
// GET /v1/disputes[?status=].
func (c *Client) ListDisputes(ctx context.Context, status string) ([]Dispute, error) {
	q := newQuery()
	q.add("status", status)
	var out []Dispute
	if err := c.do(ctx, http.MethodGet, "/v1/disputes"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetDispute fetches a dispute by id. GET /v1/disputes/:id.
func (c *Client) GetDispute(ctx context.Context, id string) (*Dispute, error) {
	var out Dispute
	if err := c.do(ctx, http.MethodGet, "/v1/disputes/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SubmitEvidenceInput is the body for SubmitDisputeEvidence. Kind is one of:
// "text", "receipt", "shipping", "communication", "url", "file".
type SubmitEvidenceInput struct {
	Kind        string `json:"kind"`
	Description string `json:"description"`
	Value       string `json:"value"`
}

// SubmitDisputeEvidence attaches evidence to a dispute.
// POST /v1/disputes/:id/evidence.
func (c *Client) SubmitDisputeEvidence(ctx context.Context, id string, in SubmitEvidenceInput) (*Dispute, error) {
	var out Dispute
	if err := c.do(ctx, http.MethodPost, "/v1/disputes/"+id+"/evidence", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ResolveDispute resolves a dispute with an outcome ("won", "lost", "refunded").
// POST /v1/disputes/:id/resolve.
func (c *Client) ResolveDispute(ctx context.Context, id, outcome string) (*Dispute, error) {
	var out Dispute
	body := map[string]string{"outcome": outcome}
	if err := c.do(ctx, http.MethodPost, "/v1/disputes/"+id+"/resolve", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
