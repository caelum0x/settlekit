package settlekit

import (
	"context"
	"net/http"
)

// RevenuePoint is one day in the analytics revenue series.
type RevenuePoint struct {
	Date   string  `json:"date"`
	Amount float64 `json:"amount"`
}

// AnalyticsSummary is the live merchant dashboard summary returned by
// GET /v1/analytics/summary. Every figure is computed from real data.
type AnalyticsSummary struct {
	Revenue               Money          `json:"revenue"`
	Customers             int            `json:"customers"`
	ActiveAccess          int            `json:"activeAccess"`
	ExpiringSubscriptions int            `json:"expiringSubscriptions"`
	FailedDeliveries      int            `json:"failedDeliveries"`
	MRR                   Money          `json:"mrr"`
	RevenueSeries         []RevenuePoint `json:"revenueSeries"`
}

// AnalyticsSummary fetches the merchant dashboard summary for an organization
// (pass "" for the platform default org). GET /v1/analytics/summary.
func (c *Client) AnalyticsSummary(ctx context.Context, organizationID string) (*AnalyticsSummary, error) {
	q := newQuery()
	if organizationID != "" {
		q.add("organizationId", organizationID)
	}
	var out AnalyticsSummary
	if err := c.do(ctx, http.MethodGet, "/v1/analytics/summary"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
