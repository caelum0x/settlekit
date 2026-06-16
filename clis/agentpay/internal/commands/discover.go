package commands

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"

	"github.com/settlekit/agentpay/internal/client"
)

// agentService mirrors the AgentService shape returned by GET /v1/agent-services.
type agentService struct {
	ID              string `json:"id"`
	OrganizationID  string `json:"organizationId"`
	MerchantID      string `json:"merchantId"`
	ProductID       string `json:"productId"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Endpoint        string `json:"endpoint"`
	Price           string `json:"price"`
	Currency        string `json:"currency"`
	PaymentProtocol string `json:"paymentProtocol"`
	Network         string `json:"network"`
	Published       bool   `json:"published"`
	CreatedAt       string `json:"createdAt"`
}

// marketplaceListing mirrors the MarketplaceListing shape returned by
// GET /v1/marketplace/listings.
type marketplaceListing struct {
	ID             string   `json:"id"`
	OrganizationID string   `json:"organizationId"`
	MerchantID     string   `json:"merchantId"`
	ProductID      string   `json:"productId,omitempty"`
	AgentServiceID string   `json:"agentServiceId,omitempty"`
	Title          string   `json:"title"`
	Summary        string   `json:"summary"`
	Tags           []string `json:"tags"`
	Published      bool     `json:"published"`
	RatingAverage  float64  `json:"ratingAverage"`
	RatingCount    int      `json:"ratingCount"`
	CreatedAt      string   `json:"createdAt"`
}

func discoverCommand() Command {
	return Command{
		Name:    "discover",
		Summary: "List discoverable agent services and marketplace listings",
		Run:     runDiscover,
	}
}

func runDiscover(ctx context.Context, api *client.Client, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("discover", flag.ContinueOnError)
	fs.SetOutput(stderr)
	tag := fs.String("tag", "", "filter by tag (matches marketplace tags and service network)")
	maxPrice := fs.String("max-price", "", "only show agent services priced at or below this amount, e.g. 0.01")
	sortBy := fs.String("sort", "top", "marketplace sort: top|new|price")
	query := fs.String("q", "", "free-text search query for marketplace listings")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "Usage: agentpay discover [--tag <tag>] [--max-price <amount>] [--sort top|new|price] [--q <query>]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	services, err := fetchAgentServices(ctx, api, *tag, *maxPrice)
	if err != nil {
		return err
	}
	listings, err := fetchListings(ctx, api, *tag, *sortBy, *query)
	if err != nil {
		return err
	}

	printAgentServices(stdout, services)
	fmt.Fprintln(stdout)
	printListings(stdout, listings)
	return nil
}

func fetchAgentServices(ctx context.Context, api *client.Client, tag, maxPrice string) ([]agentService, error) {
	var services []agentService
	if err := api.Get(ctx, "/v1/agent-services", nil, &services); err != nil {
		return nil, fmt.Errorf("list agent services: %w", err)
	}

	filtered := make([]agentService, 0, len(services))
	for _, svc := range services {
		if tag != "" && !strings.EqualFold(svc.Network, tag) {
			// Agent services have no tags; treat --tag as a network filter for them.
			continue
		}
		if maxPrice != "" {
			ok, err := withinMaxPrice(svc.Price, maxPrice)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		filtered = append(filtered, svc)
	}
	sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].Name < filtered[j].Name })
	return filtered, nil
}

func fetchListings(ctx context.Context, api *client.Client, tag, sortBy, query string) ([]marketplaceListing, error) {
	q := url.Values{}
	if tag != "" {
		q.Set("tag", tag)
	}
	if sortBy != "" {
		q.Set("sort", sortBy)
	}
	if query != "" {
		q.Set("q", query)
	}
	var listings []marketplaceListing
	if err := api.Get(ctx, "/v1/marketplace/listings", q, &listings); err != nil {
		return nil, fmt.Errorf("list marketplace listings: %w", err)
	}
	return listings, nil
}

func printAgentServices(w io.Writer, services []agentService) {
	fmt.Fprintf(w, "Agent services (%d)\n", len(services))
	if len(services) == 0 {
		fmt.Fprintln(w, "  (none)")
		return
	}
	for _, svc := range services {
		fmt.Fprintf(w, "  • %s  [%s]\n", svc.Name, svc.ID)
		fmt.Fprintf(w, "    price:    %s %s via %s on %s\n", priceOrUnknown(svc.Price), orDefault(svc.Currency, "USDC"), orDefault(svc.PaymentProtocol, "x402"), orDefault(svc.Network, "?"))
		fmt.Fprintf(w, "    endpoint: %s\n", orDefault(svc.Endpoint, "(unpublished)"))
		if svc.Description != "" {
			fmt.Fprintf(w, "    %s\n", svc.Description)
		}
	}
}

func printListings(w io.Writer, listings []marketplaceListing) {
	fmt.Fprintf(w, "Marketplace listings (%d)\n", len(listings))
	if len(listings) == 0 {
		fmt.Fprintln(w, "  (none)")
		return
	}
	for _, listing := range listings {
		fmt.Fprintf(w, "  • %s  [%s]\n", listing.Title, listing.ID)
		if listing.AgentServiceID != "" {
			fmt.Fprintf(w, "    service:  %s\n", listing.AgentServiceID)
		}
		fmt.Fprintf(w, "    rating:   %.1f (%d)\n", listing.RatingAverage, listing.RatingCount)
		if len(listing.Tags) > 0 {
			fmt.Fprintf(w, "    tags:     %s\n", strings.Join(listing.Tags, ", "))
		}
		if listing.Summary != "" {
			fmt.Fprintf(w, "    %s\n", listing.Summary)
		}
	}
}

func priceOrUnknown(price string) string {
	if price == "" {
		return "?"
	}
	return price
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
