package settlekit

// This file holds the wire types for the SettleKit resources added alongside the
// original core domain (see types.go). They are kept here so the original
// types.go stays untouched. JSON tags match the API wire format exactly so values
// round-trip through the { "data": ... } envelope without transformation.

// ---- Marketplace -----------------------------------------------------------

// Listing is a marketplace listing: a product surfaced for public discovery on
// the SettleKit marketplace.
type Listing struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organizationId"`
	MerchantID     string         `json:"merchantId"`
	ProductID      string         `json:"productId"`
	Title          string         `json:"title"`
	Summary        string         `json:"summary,omitempty"`
	Description    string         `json:"description,omitempty"`
	Category       string         `json:"category,omitempty"`
	Tags           []string       `json:"tags"`
	Price          Money          `json:"price"`
	Status         string         `json:"status"`
	RatingAverage  float64        `json:"ratingAverage"`
	RatingCount    int            `json:"ratingCount"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
	PublishedAt    string         `json:"publishedAt,omitempty"`
}

// SellerProfile is the public seller (merchant) profile shown on the
// marketplace, aggregating the merchant's listings and ratings.
type SellerProfile struct {
	MerchantID    string    `json:"merchantId"`
	DisplayName   string    `json:"displayName,omitempty"`
	Bio           string    `json:"bio,omitempty"`
	ListingCount  int       `json:"listingCount"`
	RatingAverage float64   `json:"ratingAverage"`
	RatingCount   int       `json:"ratingCount"`
	Listings      []Listing `json:"listings,omitempty"`
	CreatedAt     string    `json:"createdAt,omitempty"`
}

// ---- Agent services --------------------------------------------------------

// AgentService is a machine-callable service that agents can discover and pay
// for. Its metadata document (see AgentServiceMetadata) describes how to invoke
// and pay for it.
type AgentService struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organizationId"`
	MerchantID     string         `json:"merchantId"`
	ProductID      string         `json:"productId,omitempty"`
	Name           string         `json:"name"`
	Description    string         `json:"description,omitempty"`
	Endpoint       string         `json:"endpoint"`
	Price          Money          `json:"price"`
	Network        string         `json:"network,omitempty"`
	Status         string         `json:"status"`
	Capabilities   []string       `json:"capabilities,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
	PublishedAt    string         `json:"publishedAt,omitempty"`
}

// AgentServiceMetadata is the public metadata.json document for an agent
// service, describing how an agent invokes and pays for it (x402-style).
type AgentServiceMetadata struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Description  string         `json:"description,omitempty"`
	Endpoint     string         `json:"endpoint"`
	Price        Money          `json:"price"`
	Asset        string         `json:"asset,omitempty"`
	Network      string         `json:"network,omitempty"`
	PayTo        string         `json:"payTo,omitempty"`
	Scheme       string         `json:"scheme,omitempty"`
	Capabilities []string       `json:"capabilities,omitempty"`
	Schema       map[string]any `json:"schema,omitempty"`
}

// ---- Usage & credits -------------------------------------------------------

// UsageRecord is a recorded metered-usage event for a customer/product metric.
type UsageRecord struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organizationId"`
	CustomerID     string         `json:"customerId"`
	ProductID      string         `json:"productId"`
	Metric         string         `json:"metric"`
	Quantity       int            `json:"quantity"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	RecordedAt     string         `json:"recordedAt"`
	CreatedAt      string         `json:"createdAt"`
}

// CreditBalance is an organization's prepaid credit balance.
type CreditBalance struct {
	OrganizationID string `json:"organizationId"`
	Credits        int    `json:"credits"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
}

// ---- Subscriptions ---------------------------------------------------------

// Subscription is a recurring subscription bound to a customer and price.
type Subscription struct {
	ID                 string         `json:"id"`
	OrganizationID     string         `json:"organizationId"`
	CustomerID         string         `json:"customerId"`
	ProductID          string         `json:"productId"`
	PriceID            string         `json:"priceId"`
	Status             string         `json:"status"`
	Interval           string         `json:"interval,omitempty"`
	Amount             Money          `json:"amount"`
	CurrentPeriodStart string         `json:"currentPeriodStart,omitempty"`
	CurrentPeriodEnd   string         `json:"currentPeriodEnd,omitempty"`
	CancelAtPeriodEnd  bool           `json:"cancelAtPeriodEnd,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
	CreatedAt          string         `json:"createdAt"`
	UpdatedAt          string         `json:"updatedAt,omitempty"`
}

// ---- Webhooks --------------------------------------------------------------

// WebhookEndpoint is a registered webhook delivery target. The SigningSecret is
// returned at creation and is used to verify the X-SettleKit-Signature header on
// delivered events (see VerifySignature).
type WebhookEndpoint struct {
	ID             string   `json:"id"`
	OrganizationID string   `json:"organizationId"`
	URL            string   `json:"url"`
	EnabledEvents  []string `json:"enabledEvents"`
	Status         string   `json:"status"`
	SigningSecret  string   `json:"signingSecret,omitempty"`
	CreatedAt      string   `json:"createdAt"`
}

// WebhookEvent is an emitted event. The signed delivery payload is
// { id, type, data, createdAt }; the SettleKit-Signature header carries
// "t=<unix>,v1=<hex hmac sha256 of "<t>.<raw body>" using the signing secret>"
// (see VerifySignature).
type WebhookEvent struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organizationId,omitempty"`
	Type           string         `json:"type"`
	Data           map[string]any `json:"data"`
	CreatedAt      string         `json:"createdAt"`
}
