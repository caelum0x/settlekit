//! Gateway error type and its HTTP/JSON representation.
//!
//! Every error maps to a stable error `code`, a safe `message`, and an HTTP
//! status. Upstream SettleKit error envelopes are surfaced with their original
//! code/message so callers retain useful context without leaking internals.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use thiserror::Error;

/// All error conditions the gateway can return to clients.
#[derive(Debug, Error)]
pub enum GatewayError {
    /// The upstream SettleKit API could not be reached or timed out.
    #[error("upstream request failed: {0}")]
    Upstream(String),

    /// The upstream returned a structured error envelope.
    #[error("upstream error [{code}]: {message}")]
    UpstreamApi {
        /// HTTP status returned by the upstream.
        status: StatusCode,
        /// The upstream error code.
        code: String,
        /// The upstream error message.
        message: String,
    },

    /// The upstream response body did not match the expected shape.
    #[error("failed to decode upstream response: {0}")]
    Decode(String),

    /// The incoming request failed validation.
    #[error("invalid request: {0}")]
    BadRequest(String),
}

impl GatewayError {
    /// The HTTP status that should accompany this error.
    fn status(&self) -> StatusCode {
        match self {
            GatewayError::Upstream(_) => StatusCode::BAD_GATEWAY,
            GatewayError::UpstreamApi { status, .. } => *status,
            GatewayError::Decode(_) => StatusCode::BAD_GATEWAY,
            GatewayError::BadRequest(_) => StatusCode::BAD_REQUEST,
        }
    }

    /// The stable machine-readable error code.
    fn code(&self) -> &str {
        match self {
            GatewayError::Upstream(_) => "upstream_unreachable",
            GatewayError::UpstreamApi { code, .. } => code,
            GatewayError::Decode(_) => "upstream_decode_error",
            GatewayError::BadRequest(_) => "bad_request",
        }
    }
}

/// The JSON error envelope returned to clients, mirroring SettleKit's shape.
#[derive(Debug, Serialize)]
struct ErrorEnvelope<'a> {
    error: ErrorBody<'a>,
}

#[derive(Debug, Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: String,
}

impl IntoResponse for GatewayError {
    fn into_response(self) -> Response {
        let status = self.status();
        let code = self.code().to_string();
        let message = self.to_string();

        // Server-side faults are logged with full context; client-side ones stay quiet.
        if status.is_server_error() {
            tracing::error!(%status, %code, %message, "gateway returned server error");
        } else {
            tracing::debug!(%status, %code, %message, "gateway returned client error");
        }

        let body = Json(ErrorEnvelope {
            error: ErrorBody {
                code: &code,
                message,
            },
        });
        (status, body).into_response()
    }
}
