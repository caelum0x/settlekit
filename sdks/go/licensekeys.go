package settlekit

import (
	"context"
	"net/http"
)

// IssueLicenseKeyInput is the body for IssueLicenseKey (POST /v1/license-keys).
type IssueLicenseKeyInput struct {
	OrganizationID string `json:"organizationId"`
	CustomerID     string `json:"customerId"`
	ProductID      string `json:"productId"`
	EntitlementID  string `json:"entitlementId"`
	MachineLimit   int    `json:"machineLimit,omitempty"`
	DomainLimit    int    `json:"domainLimit,omitempty"`
	ExpiresAt      string `json:"expiresAt,omitempty"`
}

// IssueLicenseKey issues a machine/domain-limited license key.
// POST /v1/license-keys.
func (c *Client) IssueLicenseKey(ctx context.Context, in IssueLicenseKeyInput) (*LicenseKey, error) {
	var out LicenseKey
	if err := c.do(ctx, http.MethodPost, "/v1/license-keys", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// VerifyLicenseKeyInput is the body for VerifyLicenseKey
// (POST /v1/license-keys/verify).
type VerifyLicenseKeyInput struct {
	LicenseKey string `json:"licenseKey"`
	ProductID  string `json:"productId"`
	MachineID  string `json:"machineId"`
}

// VerifyLicenseKeyResult is the verify decision. The full server payload is
// preserved in Raw for forward compatibility.
type VerifyLicenseKeyResult struct {
	Valid  bool           `json:"valid"`
	Reason string         `json:"reason,omitempty"`
	Raw    map[string]any `json:"-"`
}

// VerifyLicenseKey verifies a presented license key for a product + machine,
// activating the machine when new and within capacity.
// POST /v1/license-keys/verify.
func (c *Client) VerifyLicenseKey(ctx context.Context, in VerifyLicenseKeyInput) (*VerifyLicenseKeyResult, error) {
	var out VerifyLicenseKeyResult
	if err := c.do(ctx, http.MethodPost, "/v1/license-keys/verify", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// IssueLicenseToken mints an offline validation token for a license.
// POST /v1/license-keys/:id/token.
func (c *Client) IssueLicenseToken(ctx context.Context, id string) (string, error) {
	var out struct {
		Token string `json:"token"`
	}
	if err := c.do(ctx, http.MethodPost, "/v1/license-keys/"+id+"/token", nil, &out); err != nil {
		return "", err
	}
	return out.Token, nil
}

// RevokeLicenseKey revokes a license. POST /v1/license-keys/:id/revoke.
func (c *Client) RevokeLicenseKey(ctx context.Context, id string) (*LicenseKey, error) {
	var out LicenseKey
	if err := c.do(ctx, http.MethodPost, "/v1/license-keys/"+id+"/revoke", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
