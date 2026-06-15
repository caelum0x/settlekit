package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// Gateway is the x402 pay-per-call reverse proxy HTTP handler. Requests without
// a verified payment receive a 402 challenge advertising the requirements;
// requests carrying a verified X-Payment proof are reverse-proxied upstream.
type Gateway struct {
	cfg      Config
	verifier Verifier
	proxy    *httputil.ReverseProxy
	logger   *log.Logger
}

// NewGateway constructs a Gateway, building the single-host reverse proxy to
// the configured upstream. It returns an error if the upstream URL is invalid.
func NewGateway(cfg Config, logger *log.Logger) (*Gateway, error) {
	upstream, err := url.Parse(cfg.UpstreamURL)
	if err != nil {
		return nil, err
	}

	proxy := httputil.NewSingleHostReverseProxy(upstream)

	// Preserve the upstream's Host so virtual-hosted origins route correctly,
	// while keeping the rest of NewSingleHostReverseProxy's path/query joining.
	baseDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		baseDirector(r)
		r.Host = upstream.Host
		// Strip the payment header before forwarding: it is consumed by the
		// gateway and must not leak to the protected origin.
		r.Header.Del(PaymentHeader)
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logger.Printf("upstream proxy error for %s %s: %v", r.Method, r.URL.Path, err)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error":   "bad_gateway",
			"message": "upstream request failed",
		})
	}

	return &Gateway{
		cfg:      cfg,
		verifier: buildVerifier(cfg),
		proxy:    proxy,
		logger:   logger,
	}, nil
}

// ServeHTTP implements the x402 flow per request.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	resource := g.cfg.Resource

	raw := r.Header.Get(PaymentHeader)
	proof, err := parsePaymentHeader(raw)
	if err != nil {
		if errors.Is(err, ErrNoPayment) {
			// No payment presented yet -> advertise requirements.
			g.challenge(w, resource, "")
			return
		}
		// Present but malformed -> challenge with the reason.
		g.challenge(w, resource, err.Error())
		return
	}

	requirements := buildRequirements(g.cfg, resource)

	result := g.verifier.Verify(r.Context(), proof, requirements)
	if !result.OK {
		reason := result.Reason
		if reason == "" {
			reason = "payment verification failed"
		}
		g.logger.Printf("payment rejected for %s %s: %s", r.Method, r.URL.Path, reason)
		g.challenge(w, resource, reason)
		return
	}

	g.logger.Printf("payment accepted (txHash=%s from=%s amount=%s) -> proxying %s %s",
		proof.TxHash, proof.From, proof.Amount, r.Method, r.URL.Path)
	g.proxy.ServeHTTP(w, r)
}

// challenge writes a 402 Payment Required response: the requirements JSON in the
// body plus the X-Payment-Required and Accept-Payment headers. An optional
// reason is included when a presented payment was rejected.
func (g *Gateway) challenge(w http.ResponseWriter, resource, reason string) {
	requirements := buildRequirements(g.cfg, resource)

	requirementsJSON, err := json.Marshal(requirements)
	if err != nil {
		g.logger.Printf("failed to marshal requirements: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error":   "internal_error",
			"message": "failed to build payment requirements",
		})
		return
	}

	body := PaymentRequiredBody{
		Error:   "payment_required",
		Accepts: []PaymentRequirements{requirements},
		Reason:  reason,
	}

	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set(PaymentRequiredHeader, string(requirementsJSON))
	h.Set(AcceptPaymentHeader, string(requirementsJSON))
	w.WriteHeader(HTTPPaymentRequired)

	if err := json.NewEncoder(w).Encode(body); err != nil {
		g.logger.Printf("failed to write 402 body: %v", err)
	}
}

// writeJSON is a small helper for non-402 JSON error responses.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
