package settlekit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Regression test for the real apps/api response shape: a previous version of
// VerifyEntitlementResult decoded the success field as "granted", but the API
// (apps/api/src/routes/entitlements.ts -> packages/entitlements's
// ServiceVerifyResult) has always returned "allowed". That mismatch meant
// Allowed/Granted silently stayed false for every real response — an active,
// fully paid customer verified as denied, with no error ever raised.
func TestVerifyEntitlementDecodesAllowedField(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/entitlements/verify" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"allowed":true,"value":5,"entitlement":{"id":"ent_1","organizationId":"org_1","customerId":"cus_1","productId":"prod_1","grantedBy":{"type":"payment","id":"pay_1"},"entitlementType":"product","status":"active","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}}`))
	}))
	defer srv.Close()

	c := New("sk_test", WithBaseURL(srv.URL))
	result, err := c.VerifyEntitlement(context.Background(), VerifyEntitlementInput{
		Email:     "buyer@example.com",
		ProductID: "prod_1",
	})
	if err != nil {
		t.Fatalf("VerifyEntitlement returned an error: %v", err)
	}
	if !result.Allowed {
		t.Fatal("Allowed should be true for an active, paid entitlement (bug: stayed false forever if decoded from a \"granted\" field)")
	}
	if result.Entitlement == nil || result.Entitlement.ID != "ent_1" {
		t.Fatalf("Entitlement should be decoded from the response, got %+v", result.Entitlement)
	}
	if raw, ok := result.Raw["allowed"].(bool); !ok || !raw {
		t.Fatalf("Raw should preserve the real \"allowed\" field for forward compatibility, got %+v", result.Raw)
	}
}

// A denied check must also decode correctly (Allowed false with a reason),
// not just the happy path.
func TestVerifyEntitlementDecodesDeniedResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"allowed":false,"reason":"no_active_entitlement"}}`))
	}))
	defer srv.Close()

	c := New("sk_test", WithBaseURL(srv.URL))
	result, err := c.VerifyEntitlement(context.Background(), VerifyEntitlementInput{CustomerID: "cus_1"})
	if err != nil {
		t.Fatalf("VerifyEntitlement returned an error: %v", err)
	}
	if result.Allowed {
		t.Fatal("Allowed should be false when the API denies access")
	}
	if result.Reason != "no_active_entitlement" {
		t.Fatalf("Reason should be decoded, got %q", result.Reason)
	}
}
