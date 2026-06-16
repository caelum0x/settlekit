package settlekit

import (
	"context"
	"net/http"
)

// OrgSettings is the merchant dashboard's editable organization config.
type OrgSettings struct {
	OrgName        string `json:"orgName"`
	SupportEmail   string `json:"supportEmail"`
	PayoutCurrency string `json:"payoutCurrency"`
	WebhookSecret  string `json:"webhookSecret"`
	DefaultRail    string `json:"defaultRail"`
}

// GetSettings reads settings for an organization (pass "" for the platform
// default org). GET /v1/settings[?organizationId=].
func (c *Client) GetSettings(ctx context.Context, organizationID string) (*OrgSettings, error) {
	q := newQuery()
	q.add("organizationId", organizationID)
	var out OrgSettings
	if err := c.do(ctx, http.MethodGet, "/v1/settings"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// UpdateSettingsInput is the patch body for UpdateSettings. Only set fields are
// sent; the API merges them over current values. DefaultRail is one of "arc",
// "circle", "x402".
type UpdateSettingsInput struct {
	OrganizationID string `json:"organizationId,omitempty"`
	OrgName        string `json:"orgName,omitempty"`
	SupportEmail   string `json:"supportEmail,omitempty"`
	PayoutCurrency string `json:"payoutCurrency,omitempty"`
	WebhookSecret  string `json:"webhookSecret,omitempty"`
	DefaultRail    string `json:"defaultRail,omitempty"`
}

// UpdateSettings patches organization settings. POST /v1/settings.
func (c *Client) UpdateSettings(ctx context.Context, in UpdateSettingsInput) (*OrgSettings, error) {
	var out OrgSettings
	if err := c.do(ctx, http.MethodPost, "/v1/settings", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
