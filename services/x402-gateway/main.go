// Command x402-gateway is a production x402 pay-per-call reverse proxy.
//
// It sits in front of a protected upstream and enforces the x402 "HTTP 402
// pay-per-call" protocol: unpaid requests receive a 402 challenge advertising
// machine-readable payment requirements; requests carrying a verified payment
// proof (the X-Payment header) are transparently reverse-proxied upstream.
//
// The implementation uses only the Go standard library so it builds and runs
// offline with no external dependencies.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// shutdownTimeout bounds how long graceful shutdown waits for in-flight
// requests to drain before the server is forced closed.
const shutdownTimeout = 15 * time.Second

func main() {
	logger := log.New(os.Stdout, "[x402-gateway] ", log.LstdFlags|log.LUTC)

	cfg, err := LoadConfig()
	if err != nil {
		logger.Fatalf("configuration error: %v", err)
	}

	gateway, err := NewGateway(cfg, logger)
	if err != nil {
		logger.Fatalf("failed to build gateway: %v", err)
	}

	mux := http.NewServeMux()
	// Liveness probe is served directly without payment gating.
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "x402-gateway"})
	})
	// Everything else flows through the x402 gateway.
	mux.Handle("/", gateway)

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Run the server in a goroutine so main can block on the signal channel.
	serverErr := make(chan error, 1)
	go func() {
		verifyMode := "local"
		if cfg.VerifyURL != "" {
			verifyMode = "remote(" + cfg.VerifyURL + ")"
		}
		logger.Printf("listening on %s -> upstream %s (price=%s %s on %s, verify=%s)",
			cfg.ListenAddr, cfg.UpstreamURL, cfg.Price, cfg.Currency, cfg.Network, verifyMode)

		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	// Wait for a termination signal or a fatal server error.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		logger.Fatalf("server failed: %v", err)
	case sig := <-stop:
		logger.Printf("received %s, shutting down gracefully", sig)
	}

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Printf("graceful shutdown failed, forcing close: %v", err)
		if closeErr := server.Close(); closeErr != nil {
			logger.Printf("forced close error: %v", closeErr)
		}
		return
	}
	logger.Printf("shutdown complete")
}
