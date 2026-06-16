package settlekit

// Payout settlement methods live on *Client. The core payout lifecycle —
// CreatePayout, ListPayouts, MarkPayoutPaid, PayoutBalance and FailPayout —
// was already implemented in payments.go (alongside the payment/refund
// lifecycle, since payouts settle the proceeds of confirmed payments); the
// Payout type itself lives in types.go. To avoid redeclaring those symbols (a
// compile error) and to honor "do not modify existing files", they are not
// duplicated here.
//
// This file documents the payout surface and provides the canonical status
// constants for the Payout.Status field returned by those methods:
//
//	payout, err := c.CreatePayout(ctx, settlekit.CreatePayoutInput{
//	    OrganizationID: "org_123",
//	    WalletAddress:  "0xmerchant...",
//	    Amount:         "100.00",
//	    Network:        "base",
//	})
//	// ... later, once the on-chain transfer settles:
//	paid, err := c.MarkPayoutPaid(ctx, payout.ID, "0xtxhash...")
//	_ = paid.Status == settlekit.PayoutStatusPaid
//
// See payments.go for the method implementations:
//   - CreatePayout(ctx, CreatePayoutInput) (*Payout, error)   POST /v1/payouts
//   - ListPayouts(ctx, organizationID) ([]Payout, error)      GET  /v1/payouts
//   - PayoutBalance(ctx, organizationID) (*Money, error)      GET  /v1/payouts/balance
//   - MarkPayoutPaid(ctx, id, txHash) (*Payout, error)        POST /v1/payouts/:id/paid
//   - FailPayout(ctx, id, reason) (*Payout, error)            POST /v1/payouts/:id/fail
const (
	// PayoutStatusPending is a created payout awaiting on-chain settlement.
	PayoutStatusPending = "pending"
	// PayoutStatusPaid is a payout settled on-chain (has a TxHash).
	PayoutStatusPaid = "paid"
	// PayoutStatusFailed is a payout that failed to settle (see FailureReason).
	PayoutStatusFailed = "failed"
)
