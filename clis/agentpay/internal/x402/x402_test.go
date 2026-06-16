package x402

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEncodeDecodeProofRoundTrip(t *testing.T) {
	proof := PaymentProof{
		TxHash:  "0xabc123",
		From:    "0xfromwallet",
		Amount:  "0.005",
		Network: "base",
		Nonce:   "nonce-1",
	}
	header, err := EncodeProof(proof)
	if err != nil {
		t.Fatalf("EncodeProof: %v", err)
	}
	if header == "" {
		t.Fatal("expected non-empty header")
	}
	got, err := DecodeProof(header)
	if err != nil {
		t.Fatalf("DecodeProof: %v", err)
	}
	if got != proof {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, proof)
	}
}

func TestDecodeProofValidation(t *testing.T) {
	bad := PaymentProof{From: "0x", Amount: "1", Network: "base", Nonce: "n"} // missing txHash
	raw, _ := json.Marshal(bad)
	header := base64.StdEncoding.EncodeToString(raw)
	if _, err := DecodeProof(header); err == nil {
		t.Fatal("expected validation error for missing txHash")
	}
	if _, err := DecodeProof("!!!not-base64!!!"); err == nil {
		t.Fatal("expected base64 decode error")
	}
	if _, err := DecodeProof(""); err == nil {
		t.Fatal("expected empty-header error")
	}
}

func TestParseRequirementsFromHeader(t *testing.T) {
	req := PaymentRequirements{
		Scheme:    SchemeX402,
		Amount:    "0.01",
		Asset:     AssetUSDC,
		Network:   "base",
		PayTo:     "0xpayto",
		ProductID: "prod_1",
		Resource:  "https://svc/run",
		Nonce:     "n1",
	}
	encoded, _ := json.Marshal(req)
	resp := &http.Response{Header: http.Header{}}
	resp.Header.Set(HeaderPaymentRequired, string(encoded))

	got, err := ParseRequirements(resp, nil)
	if err != nil {
		t.Fatalf("ParseRequirements: %v", err)
	}
	if got != req {
		t.Fatalf("mismatch: got %+v want %+v", got, req)
	}
}

func TestParseRequirementsFromBody(t *testing.T) {
	req := PaymentRequirements{Scheme: SchemeX402, Amount: "0.02", Asset: AssetUSDC, Network: "arc", PayTo: "0xp", ProductID: "p", Resource: "r", Nonce: "n"}
	body, _ := json.Marshal(challengeBody{Error: "payment_required", Accepts: []PaymentRequirements{req}})
	resp := &http.Response{Header: http.Header{}}

	got, err := ParseRequirements(resp, body)
	if err != nil {
		t.Fatalf("ParseRequirements: %v", err)
	}
	if got.Amount != "0.02" || got.Network != "arc" {
		t.Fatalf("unexpected requirements: %+v", got)
	}
}

func TestParseRequirementsNoAccepts(t *testing.T) {
	body, _ := json.Marshal(challengeBody{Error: "payment_required"})
	resp := &http.Response{Header: http.Header{}}
	if _, err := ParseRequirements(resp, body); err == nil {
		t.Fatal("expected error when accepts array is empty")
	}
}

// TestCallChallengeThenPay exercises the full 402 -> pay -> success loop against
// an httptest server that mimics the SettleKit x402 server contract.
func TestCallChallengeThenPay(t *testing.T) {
	const wantNonce = "challenge-nonce"
	req := PaymentRequirements{
		Scheme:    SchemeX402,
		Amount:    "0.005",
		Asset:     AssetUSDC,
		Network:   "base",
		PayTo:     "0xmerchant",
		ProductID: "prod_x",
		Resource:  "/run",
		Nonce:     wantNonce,
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payment := r.Header.Get(HeaderPayment)
		if payment == "" {
			reqJSON, _ := json.Marshal(req)
			w.Header().Set(HeaderPaymentRequired, string(reqJSON))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(HTTPPaymentRequired)
			body, _ := json.Marshal(challengeBody{Error: "payment_required", Accepts: []PaymentRequirements{req}})
			_, _ = w.Write(body)
			return
		}
		proof, err := DecodeProof(payment)
		if err != nil || proof.Nonce != wantNonce || proof.TxHash != "0xpaidtx" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"result":"ok"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.Client())
	ctx := context.Background()

	// 1) Unpaid call -> 402 with requirements.
	resp, err := c.Call(ctx, CallOptions{URL: srv.URL + "/run"})
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if !resp.PaymentRequired {
		t.Fatalf("expected PaymentRequired, got status %d", resp.StatusCode)
	}
	if resp.Requirements.Nonce != wantNonce {
		t.Fatalf("unexpected nonce: %q", resp.Requirements.Nonce)
	}

	// 2) Paid retry -> 200 with the real response.
	proof := PaymentProof{
		TxHash:  "0xpaidtx",
		From:    "0xagent",
		Amount:  resp.Requirements.Amount,
		Network: resp.Requirements.Network,
		Nonce:   resp.Requirements.Nonce,
	}
	paid, err := c.Call(ctx, CallOptions{URL: srv.URL + "/run", Proof: &proof})
	if err != nil {
		t.Fatalf("paid call: %v", err)
	}
	if paid.PaymentRequired {
		t.Fatal("expected payment to be accepted")
	}
	if !paid.Paid || paid.StatusCode != http.StatusOK {
		t.Fatalf("unexpected paid response: %+v", paid)
	}
	if string(paid.Body) != `{"result":"ok"}` {
		t.Fatalf("unexpected body: %s", paid.Body)
	}
}
