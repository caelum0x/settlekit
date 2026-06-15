package settlekit

import "fmt"

// APIError is the typed error returned when the SettleKit API responds with a
// non-2xx status. The SettleKit API serializes failures as the envelope
// { "error": { "code", "message", "details"? } }; this type carries those
// fields plus the HTTP status code that accompanied them.
//
// APIError implements the error interface, so callers can use errors.As to
// recover the structured fields:
//
//	var apiErr *settlekit.APIError
//	if errors.As(err, &apiErr) {
//	    if apiErr.Code == "not_found" { ... }
//	}
type APIError struct {
	// Status is the HTTP status code carried by the failing response.
	Status int `json:"-"`
	// Code is the stable machine-readable error code (e.g. "not_found",
	// "validation_error", "unauthorized", "conflict", "internal_error").
	Code string `json:"code"`
	// Message is the human-readable explanation of the failure.
	Message string `json:"message"`
	// Details optionally carries structured context about the failure.
	Details map[string]any `json:"details,omitempty"`
}

// Error implements the error interface.
func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("settlekit: %s (code=%s, status=%d)", e.Message, e.Code, e.Status)
	}
	return fmt.Sprintf("settlekit: %s (status=%d)", e.Message, e.Status)
}
