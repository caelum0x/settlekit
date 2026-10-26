package settlekit

import (
	"context"
	"encoding/json"
	"net/http"
)

// ListEntitlementsOptions filters ListEntitlements. The API requires either
// CustomerID or Email (to look up by the buyer's checkout email instead of an
// id); the rest are optional.
type ListEntitlementsOptions struct {
	CustomerID string
	Email      string
	ProductID  string
	ActiveOnly bool
}

// ListEntitlements lists a customer's entitlements. GET /v1/entitlements.
func (c *Client) ListEntitlements(ctx context.Context, opts ListEntitlementsOptions) ([]Entitlement, error) {
	q := newQuery()
	q.add("customerId", opts.CustomerID)
	q.add("email", opts.Email)
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
// (POST /v1/entitlements/verify). Either CustomerID or Email is required (the
// API checks every customer matching that email in the caller's org); provide
// a Feature, a ProductID, and/or RequiredCredits to additionally check.
type VerifyEntitlementInput struct {
	CustomerID      string `json:"customerId,omitempty"`
	Email           string `json:"email,omitempty"`
	ProductID       string `json:"productId,omitempty"`
	Feature         string `json:"feature,omitempty"`
	RequiredCredits int    `json:"requiredCredits,omitempty"`
}

// VerifyEntitlementResult is the verify decision returned by
// POST /v1/entitlements/verify. The real API's success field is "allowed"
// (see apps/api/src/routes/entitlements.ts and packages/entitlements), not
// "granted" — a previous version of this struct used the wrong field name, so
// Allowed silently decoded to its zero value (false) for every real response,
// denying every real paying customer. Do not rename the JSON tag back without
// checking apps/api's EntitlementService.verify / ServiceVerifyResult first.
type VerifyEntitlementResult struct {
	Allowed     bool           `json:"allowed"`
	Reason      string         `json:"reason,omitempty"`
	Value       any            `json:"value,omitempty"`
	Entitlement *Entitlement   `json:"entitlement,omitempty"`
	Raw         map[string]any `json:"-"`
}

// UnmarshalJSON decodes the typed fields and also captures every field (known
// or not) into Raw, so callers can read forward-compatible fields the API
// adds later without a struct literal silently losing them.
func (r *VerifyEntitlementResult) UnmarshalJSON(b []byte) error {
	type typed VerifyEntitlementResult // avoid recursing into this method
	var t typed
	if err := json.Unmarshal(b, &t); err != nil {
		return err
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*r = VerifyEntitlementResult(t)
	r.Raw = raw
	return nil
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
