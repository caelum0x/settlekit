package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/settlekit/agentpay/internal/client"
)

func metadataCommand() Command {
	return Command{
		Name:    "metadata",
		Summary: "Fetch the agent-readable metadata.json for a service",
		Run:     runMetadata,
	}
}

func runMetadata(ctx context.Context, api *client.Client, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("metadata", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {
		fmt.Fprintln(stderr, "Usage: agentpay metadata <serviceId>")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		fs.Usage()
		return errors.New("metadata: exactly one <serviceId> argument is required")
	}
	serviceID := fs.Arg(0)

	// The metadata.json document is served as raw JSON (NOT inside the
	// {data} envelope), so it is fetched directly rather than via the client's
	// envelope decoder.
	endpoint := api.BaseURL() + "/v1/agent-services/" + serviceID + "/metadata.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("build metadata request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if key := api.APIKey(); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch metadata: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read metadata body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("fetch metadata: unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	pretty, err := prettyJSON(body)
	if err != nil {
		// Fall back to the raw body if it is not valid JSON for some reason.
		fmt.Fprintln(stdout, strings.TrimSpace(string(body)))
		return nil
	}
	fmt.Fprintln(stdout, pretty)
	return nil
}

// prettyJSON re-indents a JSON document for human-readable output.
func prettyJSON(raw []byte) (string, error) {
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return "", err
	}
	return buf.String(), nil
}
