package settlekit

// This file mirrors the SettleKit core domain types (defined in
// @settlekit/common and the per-domain packages) as Go structs. JSON tags
// match the API wire format exactly so values round-trip through the
// { "data": ... } envelope without transformation.

// Money is a monetary value: a decimal-string amount in the major unit plus a
// currency. SettleKit never uses floating point for money; amounts are decimal
// strings such as "25.5" or "0.005".
type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

// ---- Products & prices -----------------------------------------------------

// Product is anything a developer can sell on SettleKit.
type Product struct {
	ID             string         `json:"id"`
	MerchantID     string         `json:"merchantId"`
	OrganizationID string         `json:"organizationId"`
	Name           string         `json:"name"`
	Description    string         `json:"description"`
	Type           string         `json:"type"`
	Status         string         `json:"status"`
	DeliveryMode   string         `json:"deliveryMode"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
}

// Price is a purchasable price attached to a Product.
type Price struct {
	ID             string `json:"id"`
	ProductID      string `json:"productId"`
	Amount         string `json:"amount"`
	Currency       string `json:"currency"`
	Interval       string `json:"interval"`
	UsageBased     bool   `json:"usageBased"`
	UnitAmount     string `json:"unitAmount,omitempty"`
	CreditsGranted int    `json:"creditsGranted,omitempty"`
	Active         bool   `json:"active"`
	CreatedAt      string `json:"createdAt"`
}

// Bundle groups several products under a single price.
type Bundle struct {
	ID             string   `json:"id"`
	MerchantID     string   `json:"merchantId"`
	OrganizationID string   `json:"organizationId"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	ProductIDs     []string `json:"productIds"`
	Price          Money    `json:"price"`
	Interval       string   `json:"interval"`
	Status         string   `json:"status"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

// ---- Customers -------------------------------------------------------------

// Customer carries the external identity hooks delivery actions consume.
type Customer struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organizationId"`
	Email          string         `json:"email"`
	Name           string         `json:"name,omitempty"`
	WalletAddress  string         `json:"walletAddress,omitempty"`
	GithubUsername string         `json:"githubUsername,omitempty"`
	DiscordUserID  string         `json:"discordUserId,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      string         `json:"createdAt"`
}

// ---- Checkout & payments ---------------------------------------------------

// CheckoutLineItem is a single line in a checkout session.
type CheckoutLineItem struct {
	ProductID string `json:"productId,omitempty"`
	BundleID  string `json:"bundleId,omitempty"`
	PriceID   string `json:"priceId"`
	Quantity  int    `json:"quantity"`
}

// CheckoutSession is the pre-payment cart with a computed total.
type CheckoutSession struct {
	ID              string             `json:"id"`
	OrganizationID  string             `json:"organizationId"`
	MerchantID      string             `json:"merchantId"`
	CustomerID      string             `json:"customerId,omitempty"`
	LineItems       []CheckoutLineItem `json:"lineItems"`
	Amount          Money              `json:"amount"`
	Status          string             `json:"status"`
	PayToAddress    string             `json:"payToAddress"`
	Network         string             `json:"network"`
	SuccessURL      string             `json:"successUrl,omitempty"`
	CancelURL       string             `json:"cancelUrl,omitempty"`
	ExpiresAt       string             `json:"expiresAt"`
	CollectedFields map[string]string  `json:"collectedFields"`
	CreatedAt       string             `json:"createdAt"`
}

// Payment is an on-chain payment recorded against a checkout session.
type Payment struct {
	ID                string `json:"id"`
	OrganizationID    string `json:"organizationId"`
	CheckoutSessionID string `json:"checkoutSessionId"`
	CustomerID        string `json:"customerId"`
	Amount            Money  `json:"amount"`
	Network           string `json:"network"`
	TxHash            string `json:"txHash,omitempty"`
	Confirmations     int    `json:"confirmations"`
	Status            string `json:"status"`
	CreatedAt         string `json:"createdAt"`
	ConfirmedAt       string `json:"confirmedAt,omitempty"`
}

// ---- Entitlements ----------------------------------------------------------

// EntitlementGrant identifies the source that granted an entitlement.
type EntitlementGrant struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// Entitlement is the universal access record: a payment grants an entitlement,
// an entitlement grants access.
type Entitlement struct {
	ID               string           `json:"id"`
	OrganizationID   string           `json:"organizationId"`
	CustomerID       string           `json:"customerId"`
	ProductID        string           `json:"productId"`
	GrantedBy        EntitlementGrant `json:"grantedBy"`
	EntitlementType  string           `json:"entitlementType"`
	ResourceID       string           `json:"resourceId,omitempty"`
	Status           string           `json:"status"`
	Features         map[string]any   `json:"features,omitempty"`
	CreditsRemaining *int             `json:"creditsRemaining,omitempty"`
	Seats            *int             `json:"seats,omitempty"`
	ExpiresAt        string           `json:"expiresAt,omitempty"`
	CreatedAt        string           `json:"createdAt"`
	UpdatedAt        string           `json:"updatedAt"`
}

// ---- License keys ----------------------------------------------------------

// LicenseKey is a machine/domain-limited license issued for an entitlement.
type LicenseKey struct {
	ID                  string   `json:"id"`
	OrganizationID      string   `json:"organizationId"`
	CustomerID          string   `json:"customerId"`
	ProductID           string   `json:"productId"`
	EntitlementID       string   `json:"entitlementId"`
	Key                 string   `json:"key"`
	Status              string   `json:"status"`
	MachineLimit        int      `json:"machineLimit"`
	ActivatedMachineIDs []string `json:"activatedMachineIds"`
	DomainLimit         *int     `json:"domainLimit,omitempty"`
	ActivatedDomains    []string `json:"activatedDomains"`
	ExpiresAt           string   `json:"expiresAt,omitempty"`
	CreatedAt           string   `json:"createdAt"`
}

// ---- API keys --------------------------------------------------------------

// ApiKey is a scoped API key. Only the SHA-256 hash is persisted; the plaintext
// is returned exactly once at creation (see IssueApiKeyResult).
type ApiKey struct {
	ID             string   `json:"id"`
	OrganizationID string   `json:"organizationId"`
	CustomerID     string   `json:"customerId"`
	ProductID      string   `json:"productId"`
	EntitlementID  string   `json:"entitlementId"`
	KeyHash        string   `json:"keyHash"`
	KeyPrefix      string   `json:"keyPrefix"`
	Scopes         []string `json:"scopes"`
	Status         string   `json:"status"`
	LastUsedAt     string   `json:"lastUsedAt,omitempty"`
	CreatedAt      string   `json:"createdAt"`
}

// ---- Coupons ---------------------------------------------------------------

// CouponDiscount is the kind of reduction a coupon applies. Exactly one of the
// optional fields is populated depending on Type ("percent", "amount",
// "free-trial-days").
type CouponDiscount struct {
	Type       string `json:"type"`
	PercentOff int    `json:"percentOff,omitempty"`
	AmountOff  *Money `json:"amountOff,omitempty"`
	Days       int    `json:"days,omitempty"`
}

// Coupon is a discount coupon keyed by its code.
type Coupon struct {
	Code                string         `json:"code"`
	Name                string         `json:"name,omitempty"`
	Discount            CouponDiscount `json:"discount"`
	Currency            string         `json:"currency"`
	Status              string         `json:"status"`
	StartsAt            string         `json:"startsAt,omitempty"`
	ExpiresAt           string         `json:"expiresAt,omitempty"`
	MaxRedemptions      *int           `json:"maxRedemptions,omitempty"`
	RedeemedCount       int            `json:"redeemedCount"`
	PerCustomerLimit    *int           `json:"perCustomerLimit,omitempty"`
	MinSubtotal         *Money         `json:"minSubtotal,omitempty"`
	AppliesToProductIDs []string       `json:"appliesToProductIds,omitempty"`
}

// ---- Invoices --------------------------------------------------------------

// InvoiceLineItem is a single billed line on an invoice.
type InvoiceLineItem struct {
	Description string `json:"description"`
	Quantity    int    `json:"quantity"`
	UnitAmount  Money  `json:"unitAmount"`
}

// Invoice is a customer invoice with computed totals.
type Invoice struct {
	ID             string            `json:"id"`
	Number         string            `json:"number"`
	OrganizationID string            `json:"organizationId"`
	CustomerID     string            `json:"customerId"`
	LineItems      []InvoiceLineItem `json:"lineItems"`
	Subtotal       Money             `json:"subtotal"`
	Discount       *Money            `json:"discount,omitempty"`
	Tax            *Money            `json:"tax,omitempty"`
	Total          Money             `json:"total"`
	Currency       string            `json:"currency"`
	Status         string            `json:"status"`
	IssuedAt       string            `json:"issuedAt,omitempty"`
	DueAt          string            `json:"dueAt,omitempty"`
	PaidAt         string            `json:"paidAt,omitempty"`
	Metadata       map[string]string `json:"metadata"`
}

// ---- Refunds ---------------------------------------------------------------

// Refund is a refund against a confirmed payment.
type Refund struct {
	ID            string `json:"id"`
	PaymentID     string `json:"paymentId"`
	CustomerID    string `json:"customerId"`
	Amount        Money  `json:"amount"`
	Reason        string `json:"reason"`
	Status        string `json:"status"`
	FailureReason string `json:"failureReason,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// ---- Payouts ---------------------------------------------------------------

// Payout is a settlement of funds to a merchant organization's wallet.
type Payout struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organizationId"`
	WalletAddress  string `json:"walletAddress"`
	Amount         Money  `json:"amount"`
	Network        string `json:"network"`
	Status         string `json:"status"`
	TxHash         string `json:"txHash,omitempty"`
	FailureReason  string `json:"failureReason,omitempty"`
	CreatedAt      string `json:"createdAt"`
	PaidAt         string `json:"paidAt,omitempty"`
}

// ---- Auth ------------------------------------------------------------------

// Account is a SettleKit authentication principal.
type Account struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Email          string `json:"email"`
	OrganizationID string `json:"organizationId,omitempty"`
	DisplayName    string `json:"displayName,omitempty"`
	CreatedAt      string `json:"createdAt"`
}
