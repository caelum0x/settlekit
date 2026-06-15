package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// VerifyResult is the outcome of verifying a payment proof. It mirrors the
// packages/x402 VerifyResult contract (`{ ok, reason? }`).
type VerifyResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
}

// remoteVerifyRequest is the body POSTed to a configured VERIFY_URL. It carries
// both the parsed proof and the challenged requirements so the remote verifier
// can confirm the on-chain transfer matches what was advertised.
type remoteVerifyRequest struct {
	Proof        PaymentProof        `json:"proof"`
	Requirements PaymentRequirements `json:"requirements"`
}

// Verifier confirms that a payment proof satisfies the challenged requirements.
type Verifier interface {
	Verify(ctx context.Context, proof PaymentProof, req PaymentRequirements) VerifyResult
}

// localVerifier validates a proof statelessly: the echoed nonce must match the
// challenge for the resource and the paid amount must be >= the price. This is
// used when no VERIFY_URL is configured.
type localVerifier struct {
	cfg Config
}

func (v localVerifier) Verify(_ context.Context, proof PaymentProof, req PaymentRequirements) VerifyResult {
	if !nonceMatches(v.cfg, req.Resource, proof.Nonce) {
		return VerifyResult{OK: false, Reason: "nonce does not match challenge"}
	}
	if proof.Network != req.Network {
		return VerifyResult{OK: false, Reason: fmt.Sprintf("network mismatch: proof %q vs required %q", proof.Network, req.Network)}
	}
	enough, err := amountAtLeast(proof.Amount, v.cfg.PriceValue)
	if err != nil {
		return VerifyResult{OK: false, Reason: fmt.Sprintf("payment amount %q is not a valid decimal", proof.Amount)}
	}
	if !enough {
		return VerifyResult{OK: false, Reason: fmt.Sprintf("payment amount %s is below price %s", proof.Amount, v.cfg.Price)}
	}
	return VerifyResult{OK: true}
}

// remoteVerifier delegates verification to a configured VERIFY_URL by POSTing
// the proof + requirements and requiring a `{ "ok": true }` JSON response.
type remoteVerifier struct {
	url    string
	client *http.Client
}

func newRemoteVerifier(url string) remoteVerifier {
	return remoteVerifier{
		url:    url,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (v remoteVerifier) Verify(ctx context.Context, proof PaymentProof, req PaymentRequirements) VerifyResult {
	payload, err := json.Marshal(remoteVerifyRequest{Proof: proof, Requirements: req})
	if err != nil {
		return VerifyResult{OK: false, Reason: "failed to encode verification request"}
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, v.url, bytes.NewReader(payload))
	if err != nil {
		return VerifyResult{OK: false, Reason: "failed to build verification request"}
	}
	httpReq.Header.Set("Content-Type", "application/json; charset=utf-8")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := v.client.Do(httpReq)
	if err != nil {
		return VerifyResult{OK: false, Reason: "verification service unreachable"}
	}
	defer resp.Body.Close()

	// Cap the body we read so a misbehaving verifier cannot exhaust memory.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return VerifyResult{OK: false, Reason: "failed to read verification response"}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return VerifyResult{OK: false, Reason: fmt.Sprintf("verification service returned status %d", resp.StatusCode)}
	}

	var result VerifyResult
	if err := json.Unmarshal(body, &result); err != nil {
		return VerifyResult{OK: false, Reason: "verification response is not valid JSON"}
	}
	if !result.OK && result.Reason == "" {
		result.Reason = "payment verification failed"
	}
	return result
}

// buildVerifier selects the remote verifier when VERIFY_URL is set, otherwise
// the stateless local verifier.
func buildVerifier(cfg Config) Verifier {
	if cfg.VerifyURL != "" {
		return newRemoteVerifier(cfg.VerifyURL)
	}
	return localVerifier{cfg: cfg}
}
