package settlekit

import (
	"context"
	"net/http"
)

// RecordPaymentInput is the body for RecordPayment (POST /v1/payments).
type RecordPaymentInput struct {
	CheckoutSessionID string `json:"checkoutSessionId"`
	TxHash            string `json:"txHash,omitempty"`
}

// RecordPayment records a pending payment against a checkout session.
// POST /v1/payments.
func (c *Client) RecordPayment(ctx context.Context, in RecordPaymentInput) (*Payment, error) {
	var out Payment
	if err := c.do(ctx, http.MethodPost, "/v1/payments", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetPayment fetches a payment by id. GET /v1/payments/:id.
func (c *Client) GetPayment(ctx context.Context, id string) (*Payment, error) {
	var out Payment
	if err := c.do(ctx, http.MethodGet, "/v1/payments/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ConfirmPaymentInput is the body for ConfirmPayment
// (POST /v1/payments/:id/confirm).
type ConfirmPaymentInput struct {
	TxHash           string `json:"txHash"`
	Confirmations    int    `json:"confirmations"`
	MinConfirmations int    `json:"minConfirmations,omitempty"`
}

// ConfirmPaymentResult is the response from ConfirmPayment: the confirmed
// payment plus any entitlements granted for the purchased products.
type ConfirmPaymentResult struct {
	Payment      Payment       `json:"payment"`
	Entitlements []Entitlement `json:"entitlements"`
}

// ConfirmPayment confirms a payment, completing its checkout session and
// granting entitlements. POST /v1/payments/:id/confirm.
func (c *Client) ConfirmPayment(ctx context.Context, id string, in ConfirmPaymentInput) (*ConfirmPaymentResult, error) {
	var out ConfirmPaymentResult
	if err := c.do(ctx, http.MethodPost, "/v1/payments/"+id+"/confirm", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FailPayment marks a pending payment as failed. POST /v1/payments/:id/fail.
func (c *Client) FailPayment(ctx context.Context, id string) (*Payment, error) {
	var out Payment
	if err := c.do(ctx, http.MethodPost, "/v1/payments/"+id+"/fail", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RefundPayment refunds a confirmed payment. POST /v1/payments/:id/refund.
func (c *Client) RefundPayment(ctx context.Context, id string) (*Payment, error) {
	var out Payment
	if err := c.do(ctx, http.MethodPost, "/v1/payments/"+id+"/refund", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateRefundInput is the body for CreateRefund (POST /v1/refunds).
type CreateRefundInput struct {
	PaymentID      string `json:"paymentId"`
	CustomerID     string `json:"customerId"`
	Amount         string `json:"amount"`
	Reason         string `json:"reason"`
	OriginalAmount string `json:"originalAmount,omitempty"`
}

// CreateRefund creates a pending refund against a confirmed payment.
// POST /v1/refunds.
func (c *Client) CreateRefund(ctx context.Context, in CreateRefundInput) (*Refund, error) {
	var out Refund
	if err := c.do(ctx, http.MethodPost, "/v1/refunds", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListRefunds lists refunds filtered by payment id and/or customer id (pass ""
// to omit a filter; with neither, all refunds are returned). GET /v1/refunds.
func (c *Client) ListRefunds(ctx context.Context, paymentID, customerID string) ([]Refund, error) {
	q := newQuery()
	q.add("paymentId", paymentID)
	q.add("customerId", customerID)
	var out []Refund
	if err := c.do(ctx, http.MethodGet, "/v1/refunds"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SucceedRefund marks a pending refund as succeeded.
// POST /v1/refunds/:id/succeed.
func (c *Client) SucceedRefund(ctx context.Context, id string) (*Refund, error) {
	var out Refund
	if err := c.do(ctx, http.MethodPost, "/v1/refunds/"+id+"/succeed", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FailRefund marks a pending refund as failed. POST /v1/refunds/:id/fail.
func (c *Client) FailRefund(ctx context.Context, id, reason string) (*Refund, error) {
	body := map[string]any{}
	if reason != "" {
		body["reason"] = reason
	}
	var out Refund
	if err := c.do(ctx, http.MethodPost, "/v1/refunds/"+id+"/fail", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreatePayoutInput is the body for CreatePayout (POST /v1/payouts).
type CreatePayoutInput struct {
	OrganizationID string `json:"organizationId"`
	WalletAddress  string `json:"walletAddress"`
	Amount         string `json:"amount"`
	Network        string `json:"network"`
}

// CreatePayout creates a pending payout. POST /v1/payouts.
func (c *Client) CreatePayout(ctx context.Context, in CreatePayoutInput) (*Payout, error) {
	var out Payout
	if err := c.do(ctx, http.MethodPost, "/v1/payouts", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListPayouts lists payouts for an organization (pass "" for all).
// GET /v1/payouts[?organizationId=].
func (c *Client) ListPayouts(ctx context.Context, organizationID string) ([]Payout, error) {
	q := newQuery()
	q.add("organizationId", organizationID)
	var out []Payout
	if err := c.do(ctx, http.MethodGet, "/v1/payouts"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// PayoutBalance returns the available settlement balance for an organization.
// GET /v1/payouts/balance?organizationId=.
func (c *Client) PayoutBalance(ctx context.Context, organizationID string) (*Money, error) {
	q := newQuery()
	q.add("organizationId", organizationID)
	var out Money
	if err := c.do(ctx, http.MethodGet, "/v1/payouts/balance"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// MarkPayoutPaid marks a payout paid with an on-chain transaction hash.
// POST /v1/payouts/:id/paid.
func (c *Client) MarkPayoutPaid(ctx context.Context, id, txHash string) (*Payout, error) {
	body := map[string]any{"txHash": txHash}
	var out Payout
	if err := c.do(ctx, http.MethodPost, "/v1/payouts/"+id+"/paid", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FailPayout marks a payout as failed. POST /v1/payouts/:id/fail.
func (c *Client) FailPayout(ctx context.Context, id, reason string) (*Payout, error) {
	body := map[string]any{}
	if reason != "" {
		body["reason"] = reason
	}
	var out Payout
	if err := c.do(ctx, http.MethodPost, "/v1/payouts/"+id+"/fail", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
