package client

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetUnwrapsEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("missing/incorrect auth header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"svc_1","name":"summarizer"}}`))
	}))
	defer srv.Close()

	c := New(WithBaseURL(srv.URL), WithAPIKey("test-key"))

	var out struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := c.Get(context.Background(), "/v1/agent-services/svc_1", nil, &out); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if out.ID != "svc_1" || out.Name != "summarizer" {
		t.Fatalf("unexpected decode: %+v", out)
	}
}

func TestErrorEnvelopeBecomesAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"service not found"}}`))
	}))
	defer srv.Close()

	c := New(WithBaseURL(srv.URL))
	var out map[string]any
	err := c.Get(context.Background(), "/v1/agent-services/missing", nil, &out)
	if err == nil {
		t.Fatal("expected error")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.Status != http.StatusNotFound || apiErr.Code != "not_found" {
		t.Fatalf("unexpected APIError: %+v", apiErr)
	}
}

func TestPostSendsBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"ok":true}}`))
	}))
	defer srv.Close()

	c := New(WithBaseURL(srv.URL))
	var out struct {
		OK bool `json:"ok"`
	}
	if err := c.Post(context.Background(), "/v1/things", map[string]string{"name": "x"}, &out); err != nil {
		t.Fatalf("Post: %v", err)
	}
	if !out.OK {
		t.Fatal("expected ok=true")
	}
}
