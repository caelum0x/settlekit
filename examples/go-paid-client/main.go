// Command paidclient is a runnable example of an x402 "pay-per-call" client for
// a SettleKit paid API endpoint.
//
// The x402 flow this client implements:
//
//  1. GET the protected resource with no payment.
//  2. The server answers HTTP 402 Payment Required with a body of the form
//     {"error":"payment_required","accepts":[<PaymentRequirements>]}.
//  3. The client reads accepts[0], settles the owed USDC on-chain (out of band),
//     then builds a PaymentProof {txHash, from, amount, network, nonce} where the
//     nonce is echoed verbatim from the requirements so the server can bind the
//     proof to this exact challenge.
//  4. The proof is JSON-serialized, base64-encoded, and sent back as the
//     "X-PAYMENT" header on a retry GET, which returns the paid result.
//
// This program does NOT perform the on-chain transfer itself; it takes the
// resulting --tx-hash (and --from) as input, which mirrors how a real agent
// would settle the payment with its wallet and then present the receipt.
//
// Stdlib only: net/http, encoding/json, encoding/base64, flag, fmt, os.
package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const (
	// httpPaymentRequired is the status code used to challenge an unpaid request.
	httpPaymentRequired = 402

	// paymentHeader carries the base64-encoded JSON proof on the retried request.
	paymentHeader = "X-PAYMENT"

	// defaultURL is the SettleKit public paid endpoint (price 0.005 USDC).
	defaultURL = "http://localhost:8787/v1/paid/research"

	// defaultNetwork is the settlement network advertised by SettleKit's x402.
	defaultNetwork = "arc"

	// requestTimeout bounds each HTTP call so the CLI never hangs indefinitely.
	requestTimeout = 30 * time.Second
)

// PaymentRequirements is the machine-readable challenge advertised on a 402
// response under accepts[0]. It mirrors the @settlekit/x402 wire contract.
type PaymentRequirements struct {
	Scheme string `json:"scheme"`
	// Amount is the decimal major-unit amount owed, e.g. "0.005".
	Amount string `json:"amount"`
	// Asset is the settlement asset symbol; SettleKit x402 settles in USDC.
	Asset string `json:"asset"`
	// Network is the chain the payment must settle on (e.g. "arc").
	Network string `json:"network"`
	// PayTo is the address the payment must be sent to.
	PayTo string `json:"payTo"`
	// ProductID is the product the call is gated behind (usage attribution).
	ProductID string `json:"productId"`
	// Resource is the canonical identifier of the protected resource.
	Resource string `json:"resource"`
	// Nonce is the one-time value the client must echo back in the proof.
	Nonce string `json:"nonce"`
}

// paymentRequiredBody is the JSON envelope of a 402 response. The advertised
// requirements live in accepts[0].
type paymentRequiredBody struct {
	Error   string                `json:"error"`
	Accepts []PaymentRequirements `json:"accepts"`
	Reason  string                `json:"reason,omitempty"`
}

// PaymentProof is the proof-of-payment the client sends back, base64-encoded,
// in the X-PAYMENT header on the paid retry.
type PaymentProof struct {
	// TxHash is the on-chain transaction hash of the settling transfer.
	TxHash string `json:"txHash"`
	// From is the address that sent the funds.
	From string `json:"from"`
	// Amount is the decimal major-unit amount that was paid.
	Amount string `json:"amount"`
	// Network is the chain the payment settled on.
	Network string `json:"network"`
	// Nonce is the value echoed verbatim from the challenge requirements.
	Nonce string `json:"nonce"`
}

// flags holds the parsed command-line configuration.
type flags struct {
	url     string
	txHash  string
	from    string
	network string
}

func parseFlags(args []string) (flags, error) {
	fs := flag.NewFlagSet("paidclient", flag.ContinueOnError)
	var f flags
	fs.StringVar(&f.url, "url", defaultURL, "URL of the SettleKit paid endpoint to call")
	fs.StringVar(&f.txHash, "tx-hash", "", "on-chain tx hash of the USDC payment; when set, the client pays and retries")
	fs.StringVar(&f.from, "from", "", "address that sent the payment (included in the proof)")
	fs.StringVar(&f.network, "network", defaultNetwork, "settlement network for the payment proof")
	if err := fs.Parse(args); err != nil {
		return flags{}, err
	}
	return f, nil
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

// run executes the full x402 flow and writes human-readable output to w.
// It is split out from main so it returns errors instead of calling os.Exit,
// which keeps the logic testable and panic-free.
func run(args []string, w io.Writer) error {
	f, err := parseFlags(args)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: requestTimeout}

	status, body, err := getResource(client, f.url, "")
	if err != nil {
		return fmt.Errorf("initial GET %s: %w", f.url, err)
	}

	switch status {
	case http.StatusOK:
		fmt.Fprintln(w, "200 OK — resource was free or already paid:")
		return printJSON(w, body)

	case httpPaymentRequired:
		return handlePaymentRequired(client, f, body, w)

	default:
		return fmt.Errorf("unexpected status %d from %s: %s", status, f.url, string(body))
	}
}

// handlePaymentRequired parses the 402 challenge, prints the requirements, and —
// when a tx hash is supplied — builds the proof and retries to fetch the result.
func handlePaymentRequired(client *http.Client, f flags, body []byte, w io.Writer) error {
	req, err := parsePaymentRequirements(body)
	if err != nil {
		return err
	}

	fmt.Fprintln(w, "402 Payment Required — payment requirements:")
	fmt.Fprintf(w, "  scheme    : %s\n", req.Scheme)
	fmt.Fprintf(w, "  amount    : %s %s\n", req.Amount, req.Asset)
	fmt.Fprintf(w, "  network   : %s\n", req.Network)
	fmt.Fprintf(w, "  payTo     : %s\n", req.PayTo)
	fmt.Fprintf(w, "  productId : %s\n", req.ProductID)
	fmt.Fprintf(w, "  resource  : %s\n", req.Resource)
	fmt.Fprintf(w, "  nonce     : %s\n", req.Nonce)

	if f.txHash == "" {
		fmt.Fprintf(w, "\nPay %s %s on %s to %s, then re-run with --tx-hash (and --from) to retrieve the result.\n",
			req.Amount, req.Asset, req.Network, req.PayTo)
		return nil
	}

	// The client decides which network the proof claims. We honour an explicit
	// --network flag; otherwise we settle on the network the server requires.
	network := f.network
	if network == "" {
		network = req.Network
	}

	proof := PaymentProof{
		TxHash:  f.txHash,
		From:    f.from,
		Amount:  req.Amount,
		Network: network,
		Nonce:   req.Nonce, // echo the challenge nonce verbatim
	}

	header, err := encodePaymentProof(proof)
	if err != nil {
		return fmt.Errorf("encoding payment proof: %w", err)
	}

	fmt.Fprintf(w, "\nPaying with %s header (proof for tx %s)...\n", paymentHeader, proof.TxHash)

	status, retryBody, err := getResource(client, f.url, header)
	if err != nil {
		return fmt.Errorf("paid retry GET %s: %w", f.url, err)
	}

	if status == http.StatusOK {
		fmt.Fprintln(w, "\n200 OK — paid result:")
		return printJSON(w, retryBody)
	}

	// Payment was rejected (e.g. proof not yet settled on-chain). Surface the
	// server's error rather than failing opaquely.
	fmt.Fprintf(w, "\npayment not accepted (status %d):\n", status)
	if perr := printJSON(w, retryBody); perr != nil {
		// Body was not JSON; fall back to raw text.
		fmt.Fprintln(w, string(retryBody))
	}
	return fmt.Errorf("paid retry returned status %d", status)
}

// getResource performs a GET against url. When paymentHeaderValue is non-empty
// it is sent as the X-PAYMENT header. It returns the status, the full body, and
// any transport/read error.
func getResource(client *http.Client, url, paymentHeaderValue string) (int, []byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return 0, nil, fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	// Forward an optional SettleKit API key so the example works against
	// deployments that gate the endpoint behind bearer auth.
	if key := os.Getenv("SETTLEKIT_API_KEY"); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}

	if paymentHeaderValue != "" {
		req.Header.Set(paymentHeader, paymentHeaderValue)
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("performing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("reading response body: %w", err)
	}
	return resp.StatusCode, body, nil
}

// parsePaymentRequirements extracts accepts[0] from a 402 response body.
func parsePaymentRequirements(body []byte) (PaymentRequirements, error) {
	var parsed paymentRequiredBody
	if err := json.Unmarshal(body, &parsed); err != nil {
		return PaymentRequirements{}, fmt.Errorf("decoding 402 body: %w (body: %s)", err, string(body))
	}
	if len(parsed.Accepts) == 0 {
		return PaymentRequirements{}, fmt.Errorf("402 response contained no accepts[] requirements (body: %s)", string(body))
	}
	return parsed.Accepts[0], nil
}

// encodePaymentProof serializes the proof to JSON and base64-encodes it for the
// X-PAYMENT header, matching the @settlekit/x402 encodePaymentHeader format.
func encodePaymentProof(proof PaymentProof) (string, error) {
	raw, err := json.Marshal(proof)
	if err != nil {
		return "", fmt.Errorf("marshaling proof: %w", err)
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// printJSON pretty-prints a JSON body. It returns an error if body is not JSON
// so callers can fall back to raw output.
func printJSON(w io.Writer, body []byte) error {
	var pretty json.RawMessage
	if err := json.Unmarshal(body, &pretty); err != nil {
		return fmt.Errorf("response is not JSON: %w", err)
	}
	indented, err := json.MarshalIndent(pretty, "", "  ")
	if err != nil {
		return fmt.Errorf("formatting JSON: %w", err)
	}
	fmt.Fprintln(w, string(indented))
	return nil
}
