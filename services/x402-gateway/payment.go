package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// PaymentProof is the proof-of-payment parsed from the inbound X-Payment header
// (base64-encoded JSON). The shape mirrors packages/x402 PaymentProof.
type PaymentProof struct {
	TxHash  string `json:"txHash"`
	From    string `json:"from"`
	Amount  string `json:"amount"`
	Network string `json:"network"`
	Nonce   string `json:"nonce"`
}

// ErrNoPayment indicates the X-Payment header was absent: the caller should
// respond with a 402 challenge rather than treat this as a malformed proof.
var ErrNoPayment = errors.New("no payment header present")

// parsePaymentHeader reads, base64-decodes, JSON-parses and validates the
// X-Payment header value into a PaymentProof.
//
// Returns ErrNoPayment when the header is absent (signal to challenge), a
// descriptive error when present-but-malformed, or the parsed proof on success.
func parsePaymentHeader(raw string) (PaymentProof, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return PaymentProof{}, ErrNoPayment
	}

	// Accept both standard and URL-safe base64, with or without padding, so a
	// range of conforming clients interoperate.
	decoded, err := decodeBase64Flexible(raw)
	if err != nil {
		return PaymentProof{}, errors.New(PaymentHeader + " header is not valid base64")
	}

	var proof PaymentProof
	dec := json.NewDecoder(strings.NewReader(string(decoded)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&proof); err != nil {
		return PaymentProof{}, errors.New(PaymentHeader + " header is not valid JSON")
	}

	if err := validateProof(proof); err != nil {
		return PaymentProof{}, err
	}
	return proof, nil
}

// decodeBase64Flexible attempts the four common base64 alphabets/paddings.
func decodeBase64Flexible(raw string) ([]byte, error) {
	encodings := []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	}
	var lastErr error
	for _, enc := range encodings {
		if b, err := enc.DecodeString(raw); err == nil {
			return b, nil
		} else {
			lastErr = err
		}
	}
	return nil, lastErr
}

// validateProof enforces the required fields and a valid network on a proof.
func validateProof(p PaymentProof) error {
	if p.TxHash == "" {
		return errors.New(`payment proof "txHash" is required`)
	}
	if p.From == "" {
		return errors.New(`payment proof "from" is required`)
	}
	if p.Amount == "" {
		return errors.New(`payment proof "amount" is required`)
	}
	if !validNetworks[p.Network] {
		return errors.New(`payment proof "network" is invalid`)
	}
	if p.Nonce == "" {
		return errors.New(`payment proof "nonce" is required`)
	}
	return nil
}

// encodePaymentHeader serializes a proof into the standard base64-JSON header
// value, useful for clients (and manual testing) constructing a paid retry.
func encodePaymentHeader(p PaymentProof) (string, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// amountAtLeast reports whether the proof's paid amount is >= the required
// price. Both are decimal major-unit strings; we parse to float for comparison.
func amountAtLeast(proofAmount string, price float64) (bool, error) {
	paid, err := strconv.ParseFloat(strings.TrimSpace(proofAmount), 64)
	if err != nil {
		return false, err
	}
	return paid >= price, nil
}
