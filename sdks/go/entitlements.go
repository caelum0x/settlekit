package settlekit

import (
	"context"
	"net/http"
)

// ListEntitlementsOptions filters ListEntitlements. CustomerID is required by
// the API; the others are optional.
type ListEntitlementsOptions struct {
	CustomerID string
	ProductID  string
	ActiveOnly bool
}

// ListEntitlements lists a customer's entitlements. GET /v1/entitlements.
func (c *Client) ListEntitlements(ctx context.Context, opts ListEntitlementsOptions) ([]Entitlement, error) {
	q := newQuery()
	q.add("customerId", opts.CustomerID)
	q.add("productId", opts.ProductID)
	if opts.ActiveOnly {
		q.add("activeOnly", "true")
	}
	var out []Entitlement
	if err := c.do(ctx, http.MethodGet, "/v1/entitlements"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetEntitlement fetches an entitlement by id. GET /v1/entitlements/:id.
func (c *Client) GetEntitlement(ctx context.Context, id string) (*Entitlement, error) {
	var out Entitlement
	if err := c.do(ctx, http.MethodGet, "/v1/entitlements/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// VerifyEntitlementInput is the body for VerifyEntitlement
// (POST /v1/entitlements/verify). Provide a feature, a product, and/or required
// credits to check.
type VerifyEntitlementInput struct {
	CustomerID      string `json:"customerId"`
	ProductID       string `json:"productId,omitempty"`
	Feature         string `json:"feature,omitempty"`
	RequiredCredits int    `json:"requiredCredits,omitempty"`
}

// VerifyEntitlementResult is the verify decision. Fields beyond Granted vary by
// entitlement type and are preserved in Raw for forward compatibility.
type VerifyEntitlementResult struct {
	Granted          bool           `json:"granted"`
	Reason           string         `json:"reason,omitempty"`
	CreditsRemaining *int           `json:"creditsRemaining,omitempty"`
	Raw              map[string]any `json:"-"`
}

// VerifyEntitlement checks whether a customer has access (feature / credits /
// product). This is the hot-path SDK call. POST /v1/entitlements/verify.
func (c *Client) VerifyEntitlement(ctx context.Context, in VerifyEntitlementInput) (*VerifyEntitlementResult, error) {
	var out VerifyEntitlementResult
	if err := c.do(ctx, http.MethodPost, "/v1/entitlements/verify", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SpendCreditsInput is the body for SpendCredits
// (POST /v1/entitlements/spend-credits).
type SpendCreditsInput struct {
	CustomerID string `json:"customerId"`
	ProductID  string `json:"productId"`
	Amount     int    `json:"amount"`
}

// SpendCredits debits credits from a product entitlement.
// POST /v1/entitlements/spend-credits.
func (c *Client) SpendCredits(ctx context.Context, in SpendCreditsInput) (*Entitlement, error) {
	var out Entitlement
	if err := c.do(ctx, http.MethodPost, "/v1/entitlements/spend-credits", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RevokeEntitlement revokes an entitlement with an optional reason.
// POST /v1/entitlements/:id/revoke.
func (c *Client) RevokeEntitlement(ctx context.Context, id, reason string) (*Entitlement, error) {
	body := map[string]any{}
	if reason != "" {
		body["reason"] = reason
	}
	var out Entitlement
	if err := c.do(ctx, http.MethodPost, "/v1/entitlements/"+id+"/revoke", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
