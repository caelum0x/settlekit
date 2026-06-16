//! Error types for the webhook relay service.
//!
//! [`RelayError`] is the single error type used by request handlers. It carries a
//! stable machine-readable `code` and a human-readable `message`, and implements
//! [`IntoResponse`] so handlers can simply return `Result<T, RelayError>` and have
//! failures rendered as the SettleKit error envelope:
//! `{"error":{"code":"...","message":"..."}}`.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Convenience result alias used throughout the crate's HTTP layer.
pub type Result<T> = std::result::Result<T, RelayError>;

/// Every failure mode an HTTP handler can surface to a client.
#[derive(Debug, thiserror::Error)]
pub enum RelayError {
    /// The request body or path parameters failed validation.
    #[error("{0}")]
    BadRequest(String),

    /// A referenced subscriber could not be found.
    #[error("subscriber not found: {0}")]
    NotFound(String),

    /// A required field was missing or empty.
    #[error("missing field: {0}")]
    MissingField(String),

    /// An unexpected internal failure occurred.
    #[error("internal error: {0}")]
    Internal(String),
}

impl RelayError {
    /// The stable, machine-readable error code for this variant.
    fn code(&self) -> &'static str {
        match self {
            RelayError::BadRequest(_) => "bad_request",
            RelayError::NotFound(_) => "not_found",
            RelayError::MissingField(_) => "missing_field",
            RelayError::Internal(_) => "internal_error",
        }
    }

    /// The HTTP status code paired with this variant.
    fn status(&self) -> StatusCode {
        match self {
            RelayError::BadRequest(_) | RelayError::MissingField(_) => StatusCode::BAD_REQUEST,
            RelayError::NotFound(_) => StatusCode::NOT_FOUND,
            RelayError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for RelayError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = Json(json!({
            "error": {
                "code": self.code(),
                "message": self.to_string(),
            }
        }));
        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_variants_to_expected_codes_and_statuses() {
        assert_eq!(RelayError::BadRequest("x".into()).code(), "bad_request");
        assert_eq!(
            RelayError::BadRequest("x".into()).status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(RelayError::NotFound("id".into()).code(), "not_found");
        assert_eq!(
            RelayError::NotFound("id".into()).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            RelayError::MissingField("type".into()).status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            RelayError::Internal("boom".into()).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
