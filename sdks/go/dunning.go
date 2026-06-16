package settlekit

import (
	"context"
	"net/http"
)

// DunningAttemptRecord is one recorded dunning attempt.
type DunningAttemptRecord struct {
	Attempt       int    `json:"attempt"`
	Outcome       string `json:"outcome"`
	At            string `json:"at"`
	FailureReason string `json:"failureReason,omitempty"`
}

// DunningState is the recovery state of a subscription's dunning campaign.
type DunningState struct {
	SubscriptionID string                 `json:"subscriptionId"`
	Attempt        int                    `json:"attempt"`
	Status         string                 `json:"status"`
	NextAttemptAt  string                 `json:"nextAttemptAt,omitempty"`
	History        []DunningAttemptRecord `json:"history"`
	StartedAt      string                 `json:"startedAt"`
	UpdatedAt      string                 `json:"updatedAt"`
}

// StartDunning starts a dunning campaign for a subscription with a failed
// payment. POST /v1/dunning.
func (c *Client) StartDunning(ctx context.Context, subscriptionID string) (*DunningState, error) {
	var out DunningState
	body := map[string]string{"subscriptionId": subscriptionID}
	if err := c.do(ctx, http.MethodPost, "/v1/dunning", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListDunning lists active dunning campaigns, or only those due when due=true.
// GET /v1/dunning[?due=true].
func (c *Client) ListDunning(ctx context.Context, due bool) ([]DunningState, error) {
	q := newQuery()
	if due {
		q.add("due", "true")
	}
	var out []DunningState
	if err := c.do(ctx, http.MethodGet, "/v1/dunning"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// AttemptDunningInput is the body for AttemptDunning. Outcome is one of
// "recovered" or "failed"; FailureReason is optional and only used on "failed".
type AttemptDunningInput struct {
	Outcome       string `json:"outcome"`
	FailureReason string `json:"failureReason,omitempty"`
}

// AttemptDunning records an attempt outcome. A "recovered" outcome closes the
// campaign; "failed" advances or exhausts it.
// POST /v1/dunning/:subscriptionId/attempt.
func (c *Client) AttemptDunning(ctx context.Context, subscriptionID string, in AttemptDunningInput) (*DunningState, error) {
	var out DunningState
	if err := c.do(ctx, http.MethodPost, "/v1/dunning/"+subscriptionID+"/attempt", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RecoverDunning marks a subscription's dunning campaign as recovered.
// POST /v1/dunning/:subscriptionId/recover.
func (c *Client) RecoverDunning(ctx context.Context, subscriptionID string) (*DunningState, error) {
	var out DunningState
	if err := c.do(ctx, http.MethodPost, "/v1/dunning/"+subscriptionID+"/recover", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
