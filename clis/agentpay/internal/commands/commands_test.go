package commands

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/settlekit/agentpay/internal/client"
)

func TestWithinMaxPrice(t *testing.T) {
	cases := []struct {
		price, max string
		want       bool
	}{
		{"0.005", "0.01", true},
		{"0.01", "0.01", true},
		{"0.02", "0.01", false},
		{"25.00", "100", true},
		{"not-a-number", "1", false}, // unparseable price is excluded
	}
	for _, tc := range cases {
		got, err := withinMaxPrice(tc.price, tc.max)
		if err != nil {
			t.Fatalf("withinMaxPrice(%q,%q): %v", tc.price, tc.max, err)
		}
		if got != tc.want {
			t.Errorf("withinMaxPrice(%q,%q)=%v want %v", tc.price, tc.max, got, tc.want)
		}
	}
	if _, err := withinMaxPrice("1", "bad-max"); err == nil {
		t.Error("expected error for invalid --max-price")
	}
}

func TestLookup(t *testing.T) {
	for _, name := range []string{"discover", "metadata", "call"} {
		if _, ok := Lookup(name); !ok {
			t.Errorf("expected command %q to be registered", name)
		}
	}
	if _, ok := Lookup("nope"); ok {
		t.Error("unexpected command 'nope'")
	}
}

func TestRunDiscover(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/v1/agent-services"):
			_, _ = w.Write([]byte(`{"data":[{"id":"svc_1","name":"Summarizer","endpoint":"https://svc/run","price":"0.005","currency":"USDC","paymentProtocol":"x402","network":"base","published":true}]}`))
		case strings.HasPrefix(r.URL.Path, "/v1/marketplace/listings"):
			_, _ = w.Write([]byte(`{"data":[{"id":"lst_1","title":"Summarizer API","summary":"summarize text","tags":["nlp"],"ratingAverage":4.5,"ratingCount":2,"agentServiceId":"svc_1"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	api := client.New(client.WithBaseURL(srv.URL))
	var stdout, stderr bytes.Buffer
	if err := runDiscover(context.Background(), api, nil, &stdout, &stderr); err != nil {
		t.Fatalf("runDiscover: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "Summarizer") || !strings.Contains(out, "0.005") {
		t.Fatalf("expected agent service in output, got:\n%s", out)
	}
	if !strings.Contains(out, "Summarizer API") || !strings.Contains(out, "nlp") {
		t.Fatalf("expected listing in output, got:\n%s", out)
	}
}

func TestRunDiscoverMaxPriceFilter(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/v1/agent-services") {
			_, _ = w.Write([]byte(`{"data":[{"id":"cheap","name":"Cheap","price":"0.001","network":"base"},{"id":"pricey","name":"Pricey","price":"5.00","network":"base"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer srv.Close()

	api := client.New(client.WithBaseURL(srv.URL))
	var stdout, stderr bytes.Buffer
	if err := runDiscover(context.Background(), api, []string{"--max-price", "0.01"}, &stdout, &stderr); err != nil {
		t.Fatalf("runDiscover: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "Cheap") {
		t.Errorf("expected Cheap service, got:\n%s", out)
	}
	if strings.Contains(out, "Pricey") {
		t.Errorf("Pricey should have been filtered out, got:\n%s", out)
	}
}

func TestRunMetadata(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agent-services/svc_1/metadata.json" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		// Raw JSON (NOT enveloped), matching the server.
		_, _ = w.Write([]byte(`{"name":"Summarizer","price":"0.005","currency":"USDC","paymentProtocol":"x402","network":"base","endpoint":"https://svc/run"}`))
	}))
	defer srv.Close()

	api := client.New(client.WithBaseURL(srv.URL))
	var stdout, stderr bytes.Buffer
	if err := runMetadata(context.Background(), api, []string{"svc_1"}, &stdout, &stderr); err != nil {
		t.Fatalf("runMetadata: %v", err)
	}
	if !strings.Contains(stdout.String(), `"paymentProtocol": "x402"`) {
		t.Fatalf("expected pretty metadata, got:\n%s", stdout.String())
	}
}

func TestRunCallShowsRequirements(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"error":"payment_required","accepts":[{"scheme":"x402","amount":"0.005","asset":"USDC","network":"base","payTo":"0xpay","productId":"p","resource":"/run","nonce":"n1"}]}`))
	}))
	defer srv.Close()

	api := client.New(client.WithBaseURL(srv.URL))
	var stdout, stderr bytes.Buffer
	if err := runCall(context.Background(), api, []string{srv.URL + "/run"}, &stdout, &stderr); err != nil {
		t.Fatalf("runCall: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "402 Payment Required") || !strings.Contains(out, "0xpay") || !strings.Contains(out, "--tx-hash") {
		t.Fatalf("expected requirements + retry hint, got:\n%s", out)
	}
}

func TestRunCallPays(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Payment") == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write([]byte(`{"error":"payment_required","accepts":[{"scheme":"x402","amount":"0.005","asset":"USDC","network":"base","payTo":"0xpay","productId":"p","resource":"/run","nonce":"n1"}]}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"42"}`))
	}))
	defer srv.Close()

	api := client.New(client.WithBaseURL(srv.URL))
	var stdout, stderr bytes.Buffer
	args := []string{"--tx-hash", "0xpaid", "--from", "0xagent", srv.URL + "/run"}
	if err := runCall(context.Background(), api, args, &stdout, &stderr); err != nil {
		t.Fatalf("runCall: %v", err)
	}
	if !strings.Contains(stdout.String(), `"result": "42"`) {
		t.Fatalf("expected paid result, got:\n%s", stdout.String())
	}
}
