package settlekit

import (
	"context"
	"net/http"
)

// CheckoutLineItemInput is a single requested line item on a checkout session.
type CheckoutLineItemInput struct {
	PriceID   string `json:"priceId"`
	ProductID string `json:"productId,omitempty"`
	BundleID  string `json:"bundleId,omitempty"`
	Quantity  int    `json:"quantity,omitempty"`
}

// CreateCheckoutSessionInput is the body for CreateCheckoutSession
// (POST /v1/checkout-sessions).
type CreateCheckoutSessionInput struct {
	OrganizationID  string                  `json:"organizationId"`
	MerchantID      string                  `json:"merchantId"`
	CustomerID      string                  `json:"customerId,omitempty"`
	Items           []CheckoutLineItemInput `json:"items"`
	PayToAddress    string                  `json:"payToAddress"`
	Network         string                  `json:"network"`
	SuccessURL      string                  `json:"successUrl,omitempty"`
	CancelURL       string                  `json:"cancelUrl,omitempty"`
	CollectedFields map[string]string       `json:"collectedFields,omitempty"`
	TTLDays         int                     `json:"ttlDays,omitempty"`
}

// CreateCheckoutSession opens a checkout session and computes its total.
// POST /v1/checkout-sessions.
func (c *Client) CreateCheckoutSession(ctx context.Context, in CreateCheckoutSessionInput) (*CheckoutSession, error) {
	var out CheckoutSession
	if err := c.do(ctx, http.MethodPost, "/v1/checkout-sessions", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetCheckoutSession fetches a checkout session by id.
// GET /v1/checkout-sessions/:id.
func (c *Client) GetCheckoutSession(ctx context.Context, id string) (*CheckoutSession, error) {
	var out CheckoutSession
	if err := c.do(ctx, http.MethodGet, "/v1/checkout-sessions/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CollectCheckoutFields merges buyer-supplied delivery fields into an open
// session. POST /v1/checkout-sessions/:id/collect-fields.
func (c *Client) CollectCheckoutFields(ctx context.Context, id string, fields map[string]string) (*CheckoutSession, error) {
	body := map[string]any{"fields": fields}
	var out CheckoutSession
	if err := c.do(ctx, http.MethodPost, "/v1/checkout-sessions/"+id+"/collect-fields", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CancelCheckoutSession cancels an open session.
// POST /v1/checkout-sessions/:id/cancel.
func (c *Client) CancelCheckoutSession(ctx context.Context, id string) (*CheckoutSession, error) {
	var out CheckoutSession
	if err := c.do(ctx, http.MethodPost, "/v1/checkout-sessions/"+id+"/cancel", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ExpireCheckoutSession expires an open session.
// POST /v1/checkout-sessions/:id/expire.
func (c *Client) ExpireCheckoutSession(ctx context.Context, id string) (*CheckoutSession, error) {
	var out CheckoutSession
	if err := c.do(ctx, http.MethodPost, "/v1/checkout-sessions/"+id+"/expire", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
