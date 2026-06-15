package settlekit

import (
	"context"
	"net/http"
)

// CreateCouponInput is the body for CreateCoupon (POST /v1/coupons). Discount
// is required; populate the field matching Discount.Type.
type CreateCouponInput struct {
	Code                string         `json:"code"`
	Name                string         `json:"name,omitempty"`
	Discount            CouponDiscount `json:"discount"`
	Status              string         `json:"status,omitempty"`
	StartsAt            string         `json:"startsAt,omitempty"`
	ExpiresAt           string         `json:"expiresAt,omitempty"`
	MaxRedemptions      int            `json:"maxRedemptions,omitempty"`
	PerCustomerLimit    int            `json:"perCustomerLimit,omitempty"`
	MinSubtotal         string         `json:"minSubtotal,omitempty"`
	AppliesToProductIDs []string       `json:"appliesToProductIds,omitempty"`
}

// CreateCoupon creates a discount coupon. POST /v1/coupons.
func (c *Client) CreateCoupon(ctx context.Context, in CreateCouponInput) (*Coupon, error) {
	var out Coupon
	if err := c.do(ctx, http.MethodPost, "/v1/coupons", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListCoupons returns all coupons. GET /v1/coupons.
func (c *Client) ListCoupons(ctx context.Context) ([]Coupon, error) {
	var out []Coupon
	if err := c.do(ctx, http.MethodGet, "/v1/coupons", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetCoupon fetches a coupon by code. GET /v1/coupons/:code.
func (c *Client) GetCoupon(ctx context.Context, code string) (*Coupon, error) {
	var out Coupon
	if err := c.do(ctx, http.MethodGet, "/v1/coupons/"+code, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ApplyCouponInput is the body for ValidateCoupon / RedeemCoupon.
type ApplyCouponInput struct {
	Subtotal   string `json:"subtotal"`
	CustomerID string `json:"customerId,omitempty"`
}

// ApplyCouponResult is the outcome of applying a coupon to a subtotal.
type ApplyCouponResult struct {
	OK            bool   `json:"ok"`
	Discount      Money  `json:"discount"`
	Total         Money  `json:"total"`
	FreeTrialDays int    `json:"freeTrialDays,omitempty"`
	Reason        string `json:"reason,omitempty"`
}

// ValidateCoupon dry-runs a coupon against a subtotal without mutating its
// redemption count. POST /v1/coupons/:code/validate.
func (c *Client) ValidateCoupon(ctx context.Context, code string, in ApplyCouponInput) (*ApplyCouponResult, error) {
	var out ApplyCouponResult
	if err := c.do(ctx, http.MethodPost, "/v1/coupons/"+code+"/validate", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RedeemCoupon redeems a coupon against a subtotal, mutating its redemption
// count. POST /v1/coupons/:code/redeem.
func (c *Client) RedeemCoupon(ctx context.Context, code string, in ApplyCouponInput) (*ApplyCouponResult, error) {
	var out ApplyCouponResult
	if err := c.do(ctx, http.MethodPost, "/v1/coupons/"+code+"/redeem", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
