package settlekit

import (
	"context"
	"net/http"
)

// RecordUsageInput is the body for RecordUsage (POST /v1/usage/record).
type RecordUsageInput struct {
	OrganizationID string         `json:"organizationId"`
	CustomerID     string         `json:"customerId"`
	ProductID      string         `json:"productId"`
	Metric         string         `json:"metric"`
	Quantity       int            `json:"quantity"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// RecordUsage records a metered-usage event. POST /v1/usage/record.
func (c *Client) RecordUsage(ctx context.Context, in RecordUsageInput) (*UsageRecord, error) {
	var out UsageRecord
	if err := c.do(ctx, http.MethodPost, "/v1/usage/record", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetCredits returns an organization's prepaid credit balance.
// GET /v1/usage/credits[?organizationId=].
func (c *Client) GetCredits(ctx context.Context, organizationID string) (*CreditBalance, error) {
	q := newQuery()
	q.add("organizationId", organizationID)
	var out CreditBalance
	if err := c.do(ctx, http.MethodGet, "/v1/usage/credits"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GrantCredits adds prepaid credits to an organization's balance.
// POST /v1/usage/credits/grant.
func (c *Client) GrantCredits(ctx context.Context, organizationID string, credits int) (*CreditBalance, error) {
	body := map[string]any{"organizationId": organizationID, "credits": credits}
	var out CreditBalance
	if err := c.do(ctx, http.MethodPost, "/v1/usage/credits/grant", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ConsumeCredits debits prepaid credits from an organization's balance.
// POST /v1/usage/credits/consume.
func (c *Client) ConsumeCredits(ctx context.Context, organizationID string, credits int) (*CreditBalance, error) {
	body := map[string]any{"organizationId": organizationID, "credits": credits}
	var out CreditBalance
	if err := c.do(ctx, http.MethodPost, "/v1/usage/credits/consume", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
