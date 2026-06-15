package settlekit

import (
	"context"
	"net/http"
)

// CreateProductInput is the body for CreateProduct (POST /v1/products).
type CreateProductInput struct {
	MerchantID     string         `json:"merchantId"`
	OrganizationID string         `json:"organizationId"`
	Name           string         `json:"name"`
	Description    string         `json:"description,omitempty"`
	Type           string         `json:"type"`
	DeliveryMode   string         `json:"deliveryMode"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// CreateProduct creates a draft product. POST /v1/products.
func (c *Client) CreateProduct(ctx context.Context, in CreateProductInput) (*Product, error) {
	var out Product
	if err := c.do(ctx, http.MethodPost, "/v1/products", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListProducts returns all products. GET /v1/products.
func (c *Client) ListProducts(ctx context.Context) ([]Product, error) {
	var out []Product
	if err := c.do(ctx, http.MethodGet, "/v1/products", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetProduct fetches a single product by id. GET /v1/products/:id.
func (c *Client) GetProduct(ctx context.Context, id string) (*Product, error) {
	var out Product
	if err := c.do(ctx, http.MethodGet, "/v1/products/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PublishProduct publishes a product (requires an active price).
// POST /v1/products/:id/publish.
func (c *Client) PublishProduct(ctx context.Context, id string) (*Product, error) {
	var out Product
	if err := c.do(ctx, http.MethodPost, "/v1/products/"+id+"/publish", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreatePriceInput is the body for CreatePrice (POST /v1/products/:id/prices).
type CreatePriceInput struct {
	Amount         string `json:"amount"`
	Currency       string `json:"currency,omitempty"`
	Interval       string `json:"interval,omitempty"`
	UsageBased     bool   `json:"usageBased,omitempty"`
	UnitAmount     string `json:"unitAmount,omitempty"`
	CreditsGranted int    `json:"creditsGranted,omitempty"`
}

// CreatePrice attaches a price to a product. POST /v1/products/:id/prices.
func (c *Client) CreatePrice(ctx context.Context, productID string, in CreatePriceInput) (*Price, error) {
	var out Price
	if err := c.do(ctx, http.MethodPost, "/v1/products/"+productID+"/prices", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListPrices lists the prices for a product. GET /v1/products/:id/prices.
func (c *Client) ListPrices(ctx context.Context, productID string) ([]Price, error) {
	var out []Price
	if err := c.do(ctx, http.MethodGet, "/v1/products/"+productID+"/prices", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateCustomerInput is the body for CreateCustomer (POST /v1/customers).
type CreateCustomerInput struct {
	OrganizationID string         `json:"organizationId"`
	Email          string         `json:"email"`
	Name           string         `json:"name,omitempty"`
	WalletAddress  string         `json:"walletAddress,omitempty"`
	GithubUsername string         `json:"githubUsername,omitempty"`
	DiscordUserID  string         `json:"discordUserId,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// CreateCustomer creates a customer. POST /v1/customers.
func (c *Client) CreateCustomer(ctx context.Context, in CreateCustomerInput) (*Customer, error) {
	var out Customer
	if err := c.do(ctx, http.MethodPost, "/v1/customers", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListCustomers returns all customers. GET /v1/customers.
func (c *Client) ListCustomers(ctx context.Context) ([]Customer, error) {
	var out []Customer
	if err := c.do(ctx, http.MethodGet, "/v1/customers", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetCustomer fetches a customer by id. GET /v1/customers/:id.
func (c *Client) GetCustomer(ctx context.Context, id string) (*Customer, error) {
	var out Customer
	if err := c.do(ctx, http.MethodGet, "/v1/customers/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateBundleInput is the body for CreateBundle (POST /v1/bundles).
type CreateBundleInput struct {
	MerchantID     string   `json:"merchantId"`
	OrganizationID string   `json:"organizationId"`
	Name           string   `json:"name"`
	Description    string   `json:"description,omitempty"`
	ProductIDs     []string `json:"productIds"`
	Amount         string   `json:"amount,omitempty"`
	Interval       string   `json:"interval,omitempty"`
}

// CreateBundle creates a product bundle. POST /v1/bundles.
func (c *Client) CreateBundle(ctx context.Context, in CreateBundleInput) (*Bundle, error) {
	var out Bundle
	if err := c.do(ctx, http.MethodPost, "/v1/bundles", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListBundles lists bundles, optionally filtered by organization id (pass "" for
// all). GET /v1/bundles[?organizationId=].
func (c *Client) ListBundles(ctx context.Context, organizationID string) ([]Bundle, error) {
	q := newQuery()
	q.add("organizationId", organizationID)
	var out []Bundle
	if err := c.do(ctx, http.MethodGet, "/v1/bundles"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetBundle fetches a bundle by id. GET /v1/bundles/:id.
func (c *Client) GetBundle(ctx context.Context, id string) (*Bundle, error) {
	var out Bundle
	if err := c.do(ctx, http.MethodGet, "/v1/bundles/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// UpdateBundleInput is the body for UpdateBundle (PATCH /v1/bundles/:id).
type UpdateBundleInput struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Status      string `json:"status,omitempty"`
}

// UpdateBundle patches mutable bundle fields. PATCH /v1/bundles/:id.
func (c *Client) UpdateBundle(ctx context.Context, id string, in UpdateBundleInput) (*Bundle, error) {
	var out Bundle
	if err := c.do(ctx, http.MethodPatch, "/v1/bundles/"+id, in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PublishBundle activates a bundle. POST /v1/bundles/:id/publish.
func (c *Client) PublishBundle(ctx context.Context, id string) (*Bundle, error) {
	var out Bundle
	if err := c.do(ctx, http.MethodPost, "/v1/bundles/"+id+"/publish", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
