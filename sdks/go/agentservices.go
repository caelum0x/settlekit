package settlekit

import (
	"context"
	"net/http"
)

// CreateAgentServiceInput is the body for CreateAgentService
// (POST /v1/agent-services).
type CreateAgentServiceInput struct {
	OrganizationID string         `json:"organizationId"`
	MerchantID     string         `json:"merchantId"`
	ProductID      string         `json:"productId,omitempty"`
	Name           string         `json:"name"`
	Description    string         `json:"description,omitempty"`
	Endpoint       string         `json:"endpoint"`
	Amount         string         `json:"amount"`
	Currency       string         `json:"currency,omitempty"`
	Network        string         `json:"network,omitempty"`
	Capabilities   []string       `json:"capabilities,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// CreateAgentService registers a machine-callable agent service.
// POST /v1/agent-services.
func (c *Client) CreateAgentService(ctx context.Context, in CreateAgentServiceInput) (*AgentService, error) {
	var out AgentService
	if err := c.do(ctx, http.MethodPost, "/v1/agent-services", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListAgentServices lists agent services, optionally filtered by organization id
// (pass "" for all). GET /v1/agent-services[?organizationId=].
func (c *Client) ListAgentServices(ctx context.Context, organizationID string) ([]AgentService, error) {
	q := newQuery()
	q.add("organizationId", organizationID)
	var out []AgentService
	if err := c.do(ctx, http.MethodGet, "/v1/agent-services"+q.encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// PublishAgentService publishes an agent service, making it discoverable and its
// metadata document public. POST /v1/agent-services/:id/publish.
func (c *Client) PublishAgentService(ctx context.Context, id string) (*AgentService, error) {
	var out AgentService
	if err := c.do(ctx, http.MethodPost, "/v1/agent-services/"+id+"/publish", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// AgentServiceMetadata fetches the public metadata.json document for an agent
// service, describing how an agent invokes and pays for it.
// GET /v1/agent-services/:id/metadata.json.
func (c *Client) AgentServiceMetadata(ctx context.Context, id string) (*AgentServiceMetadata, error) {
	var out AgentServiceMetadata
	if err := c.do(ctx, http.MethodGet, "/v1/agent-services/"+id+"/metadata.json", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
