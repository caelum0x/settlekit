package settlekit

import (
	"context"
	"net/http"
)

// CreateSubscriptionInput is the body for CreateSubscription
// (POST /v1/subscriptions).
type CreateSubscriptionInput struct {
	OrganizationID string         `json:"organizationId"`
	CustomerID     string         `json:"customerId"`
	ProductID      string         `json:"productId"`
	PriceID        string         `json:"priceId"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// CreateSubscription creates a recurring subscription for a customer and price.
// POST /v1/subscriptions.
func (c *Client) CreateSubscription(ctx context.Context, in CreateSubscriptionInput) (*Subscription, error) {
	var out Subscription
	if err := c.do(ctx, http.MethodPost, "/v1/subscriptions", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListSubscriptions lists subscriptions, optionally filtered by customer id
// (pass "" for all). GET /v1/subscriptions[?customerId=].
func (c *Client) ListSubscriptions(ctx context.Context, customerID string) ([]Subscription, error) {
	q := newQuery()
	q.add("customerId", customerID)
	var out []Subscription
	if err := c.do(ctx, http.MethodGet, "/v1/subscriptions"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}
