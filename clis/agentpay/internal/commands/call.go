package commands

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/settlekit/agentpay/internal/client"
	"github.com/settlekit/agentpay/internal/x402"
)

func callCommand() Command {
	return Command{
		Name:    "call",
		Summary: "Call a paid endpoint; on HTTP 402 show requirements or pay with --tx-hash",
		Run:     runCall,
	}
}

func runCall(ctx context.Context, api *client.Client, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("call", flag.ContinueOnError)
	fs.SetOutput(stderr)
	method := fs.String("method", http.MethodGet, "HTTP method")
	body := fs.String("body", "", "request body sent to the service (JSON input)")
	contentType := fs.String("content-type", "application/json", "request body content type")
	txHash := fs.String("tx-hash", "", "on-chain settlement tx hash; supplying it pays a 402 challenge and retries")
	from := fs.String("from", "", "wallet address that sent the payment (proof.from)")
	amount := fs.String("amount", "", "amount paid; defaults to the 402 challenge amount")
	network := fs.String("network", "", "settlement network; defaults to the 402 challenge network")
	nonce := fs.String("nonce", "", "challenge nonce; defaults to the 402 challenge nonce")
	authHeader := fs.String("authorization", "", "Authorization header value forwarded to the protected endpoint")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "Usage: agentpay call <url> [--method GET] [--body <json>] [--tx-hash <hash> --from <addr>]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		fs.Usage()
		return errors.New("call: exactly one <url> argument is required")
	}
	target := fs.Arg(0)

	headers := map[string]string{}
	if *authHeader != "" {
		headers["Authorization"] = *authHeader
	} else if key := api.APIKey(); key != "" && strings.HasPrefix(target, api.BaseURL()) {
		// Forward the SettleKit bearer token only to the SettleKit API host.
		headers["Authorization"] = "Bearer " + key
	}

	opts := x402.CallOptions{
		Method:      *method,
		URL:         target,
		ContentType: *contentType,
		Headers:     headers,
	}
	if *body != "" {
		opts.Body = []byte(*body)
	}

	xc := x402.NewClient(&http.Client{Timeout: 30 * time.Second})

	// First call: no proof. Discover whether the endpoint is paywalled.
	resp, err := xc.Call(ctx, opts)
	if err != nil {
		return err
	}

	if !resp.PaymentRequired {
		printPaidResponse(stdout, resp)
		return nil
	}

	// The endpoint challenged us with a 402. Show the requirements.
	printRequirements(stdout, resp.Requirements)

	if *txHash == "" {
		fmt.Fprintln(stdout)
		fmt.Fprintln(stdout, "Payment required. Settle the amount above on-chain, then retry with:")
		fmt.Fprintf(stdout, "  agentpay call %s --tx-hash <hash> --from <yourWalletAddress>\n", target)
		return nil
	}

	if *from == "" {
		return errors.New("call: --from <walletAddress> is required when paying with --tx-hash")
	}

	// Build the proof, defaulting unspecified fields from the challenge so the
	// agent only needs to supply the tx hash and sending address.
	proof := x402.PaymentProof{
		TxHash:  *txHash,
		From:    *from,
		Amount:  firstNonEmptyValue(*amount, resp.Requirements.Amount),
		Network: firstNonEmptyValue(*network, resp.Requirements.Network),
		Nonce:   firstNonEmptyValue(*nonce, resp.Requirements.Nonce),
	}
	opts.Proof = &proof

	fmt.Fprintln(stdout)
	fmt.Fprintf(stdout, "Retrying with payment proof (tx %s)...\n", proof.TxHash)

	paid, err := xc.Call(ctx, opts)
	if err != nil {
		return err
	}

	if paid.PaymentRequired {
		// Verification failed server-side; surface the fresh challenge.
		fmt.Fprintln(stderr, "payment was not accepted; server re-issued a challenge:")
		printRequirements(stderr, paid.Requirements)
		printPaidResponse(stdout, paid)
		return fmt.Errorf("payment verification failed (status %d)", paid.StatusCode)
	}

	fmt.Fprintln(stdout)
	printPaidResponse(stdout, paid)
	return nil
}

func printRequirements(w io.Writer, req x402.PaymentRequirements) {
	fmt.Fprintln(w, "402 Payment Required — x402 payment requirements:")
	fmt.Fprintf(w, "  scheme:    %s\n", req.Scheme)
	fmt.Fprintf(w, "  amount:    %s %s\n", req.Amount, req.Asset)
	fmt.Fprintf(w, "  network:   %s\n", req.Network)
	fmt.Fprintf(w, "  payTo:     %s\n", req.PayTo)
	fmt.Fprintf(w, "  productId: %s\n", req.ProductID)
	fmt.Fprintf(w, "  resource:  %s\n", req.Resource)
	fmt.Fprintf(w, "  nonce:     %s\n", req.Nonce)
}

func printPaidResponse(w io.Writer, resp *x402.Response) {
	fmt.Fprintf(w, "HTTP %d\n", resp.StatusCode)
	bodyStr := strings.TrimSpace(string(resp.Body))
	if bodyStr == "" {
		return
	}
	if strings.Contains(resp.ContentType, "json") {
		if pretty, err := prettyJSON(resp.Body); err == nil {
			fmt.Fprintln(w, pretty)
			return
		}
	}
	fmt.Fprintln(w, bodyStr)
}

func firstNonEmptyValue(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
