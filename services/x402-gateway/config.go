package main

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds the runtime configuration for the x402 gateway, sourced
// entirely from environment variables so the binary stays 12-factor and
// builds/runs offline with no external dependencies.
type Config struct {
	// ListenAddr is the TCP address the HTTP server binds to (default ":8402").
	ListenAddr string

	// UpstreamURL is the origin that paid requests are reverse-proxied to.
	UpstreamURL string

	// Price is the decimal major-unit amount owed per call, e.g. "0.005".
	Price string
	// PriceValue is Price parsed to a float for local amount comparison.
	PriceValue float64

	// Currency is the settlement asset. Only "USDC" is supported.
	Currency string
	// Network is the chain a payment must settle on (arc | base | ethereum).
	Network string
	// PayTo is the destination address payments must be sent to.
	PayTo string
	// ProductID attributes the gated call for usage accounting.
	ProductID string
	// Resource is the canonical identifier of the protected resource.
	Resource string

	// VerifyURL, when set, is POSTed a payment proof to verify it remotely.
	// The verifier must respond with JSON `{ "ok": true }` to authorize.
	VerifyURL string

	// Nonce is an optional stable nonce. When set it is advertised in every
	// 402 challenge and required to match on the paid retry. When empty an
	// HMAC-derived nonce bound to the resource is generated instead.
	Nonce string

	// HMACSecret signs derived nonces. Sourced from X402_HMAC_SECRET.
	HMACSecret string
}

// validNetworks mirrors the X402Network union from packages/x402.
var validNetworks = map[string]bool{
	"arc":      true,
	"base":     true,
	"ethereum": true,
}

// getEnv returns the trimmed value of key or fallback when unset/blank.
func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// LoadConfig reads and validates configuration from the environment. It fails
// fast with a descriptive error when a required field is missing or malformed,
// so misconfiguration surfaces at startup rather than per-request.
func LoadConfig() (Config, error) {
	cfg := Config{
		ListenAddr:  getEnv("LISTEN_ADDR", ":8402"),
		UpstreamURL: getEnv("UPSTREAM_URL", ""),
		Price:       getEnv("PRICE", ""),
		Currency:    getEnv("CURRENCY", "USDC"),
		Network:     getEnv("NETWORK", ""),
		PayTo:       getEnv("PAY_TO", ""),
		ProductID:   getEnv("PRODUCT_ID", ""),
		Resource:    getEnv("RESOURCE", ""),
		VerifyURL:   getEnv("VERIFY_URL", ""),
		Nonce:       getEnv("NONCE", ""),
		HMACSecret:  getEnv("X402_HMAC_SECRET", ""),
	}

	missing := make([]string, 0, 6)
	if cfg.UpstreamURL == "" {
		missing = append(missing, "UPSTREAM_URL")
	}
	if cfg.Price == "" {
		missing = append(missing, "PRICE")
	}
	if cfg.Network == "" {
		missing = append(missing, "NETWORK")
	}
	if cfg.PayTo == "" {
		missing = append(missing, "PAY_TO")
	}
	if cfg.ProductID == "" {
		missing = append(missing, "PRODUCT_ID")
	}
	if cfg.Resource == "" {
		missing = append(missing, "RESOURCE")
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}

	if cfg.Currency != "USDC" {
		return Config{}, fmt.Errorf("only CURRENCY=USDC is supported, got %q", cfg.Currency)
	}
	if !validNetworks[cfg.Network] {
		return Config{}, fmt.Errorf("invalid NETWORK %q (want arc | base | ethereum)", cfg.Network)
	}

	priceValue, err := strconv.ParseFloat(cfg.Price, 64)
	if err != nil {
		return Config{}, fmt.Errorf("PRICE %q is not a valid decimal: %w", cfg.Price, err)
	}
	if priceValue < 0 {
		return Config{}, fmt.Errorf("PRICE %q must not be negative", cfg.Price)
	}
	cfg.PriceValue = priceValue

	if _, err := url.ParseRequestURI(cfg.UpstreamURL); err != nil {
		return Config{}, fmt.Errorf("UPSTREAM_URL %q is not a valid URL: %w", cfg.UpstreamURL, err)
	}
	if cfg.VerifyURL != "" {
		if _, err := url.ParseRequestURI(cfg.VerifyURL); err != nil {
			return Config{}, fmt.Errorf("VERIFY_URL %q is not a valid URL: %w", cfg.VerifyURL, err)
		}
	}

	// A secret is only strictly required when deriving nonces (no stable NONCE).
	if cfg.Nonce == "" && cfg.HMACSecret == "" {
		return Config{}, fmt.Errorf("either NONCE or X402_HMAC_SECRET must be set so challenge nonces can be issued and verified")
	}

	return cfg, nil
}
