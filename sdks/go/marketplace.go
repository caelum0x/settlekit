package settlekit

import (
	"context"
	"net/http"
)

// CreateListingInput is the body for CreateListing (POST /v1/marketplace/listings).
type CreateListingInput struct {
	OrganizationID string         `json:"organizationId"`
	MerchantID     string         `json:"merchantId"`
	ProductID      string         `json:"productId"`
	Title          string         `json:"title"`
	Summary        string         `json:"summary,omitempty"`
	Description    string         `json:"description,omitempty"`
	Category       string         `json:"category,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// CreateListing creates a draft marketplace listing for a product.
// POST /v1/marketplace/listings.
func (c *Client) CreateListing(ctx context.Context, in CreateListingInput) (*Listing, error) {
	var out Listing
	if err := c.do(ctx, http.MethodPost, "/v1/marketplace/listings", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListListingsOptions filters and sorts ListListings. All fields are optional;
// Sort is one of "top", "new", or "price".
type ListListingsOptions struct {
	Query string
	Tag   string
	Sort  string
}

// ListListings lists published marketplace listings, optionally filtered by a
// full-text query and tag and sorted by "top", "new", or "price".
// GET /v1/marketplace/listings[?q=&tag=&sort=].
func (c *Client) ListListings(ctx context.Context, opts ListListingsOptions) ([]Listing, error) {
	q := newQuery()
	q.add("q", opts.Query)
	q.add("tag", opts.Tag)
	q.add("sort", opts.Sort)
	var out []Listing
	if err := c.do(ctx, http.MethodGet, "/v1/marketplace/listings"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetListing fetches a single listing by id.
// GET /v1/marketplace/listings/:id.
func (c *Client) GetListing(ctx context.Context, id string) (*Listing, error) {
	var out Listing
	if err := c.do(ctx, http.MethodGet, "/v1/marketplace/listings/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PublishListing publishes a draft listing, making it publicly discoverable.
// POST /v1/marketplace/listings/:id/publish.
func (c *Client) PublishListing(ctx context.Context, id string) (*Listing, error) {
	var out Listing
	if err := c.do(ctx, http.MethodPost, "/v1/marketplace/listings/"+id+"/publish", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RateListing submits a 1-5 star rating for a listing, updating its aggregate
// rating. POST /v1/marketplace/listings/:id/rate.
func (c *Client) RateListing(ctx context.Context, id string, stars int) (*Listing, error) {
	body := map[string]any{"stars": stars}
	var out Listing
	if err := c.do(ctx, http.MethodPost, "/v1/marketplace/listings/"+id+"/rate", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SellerProfile fetches a merchant's public marketplace seller profile.
// GET /v1/marketplace/sellers/:merchantId.
func (c *Client) SellerProfile(ctx context.Context, merchantID string) (*SellerProfile, error) {
	var out SellerProfile
	if err := c.do(ctx, http.MethodGet, "/v1/marketplace/sellers/"+merchantID, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
