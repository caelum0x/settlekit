//! Error types for the SettleKit SDK.
//!
//! Every fallible SDK call returns [`Result<T, Error>`]. The [`Error`] enum
//! distinguishes between three failure classes:
//!
//! * [`Error::Api`] — the API responded with a structured `{ error }` envelope
//!   (`{ code, message, details? }`) and a non-2xx HTTP status.
//! * [`Error::Http`] — the request never produced a parseable API response
//!   (DNS failure, connection reset, TLS error, timeout, ...).
//! * [`Error::Decode`] — the response body could not be deserialized into the
//!   expected shape.

use std::collections::BTreeMap;

use serde::Deserialize;
use thiserror::Error;

/// The result type used throughout the SDK.
pub type Result<T> = std::result::Result<T, Error>;

/// All errors the SDK can surface to a caller.
#[derive(Debug, Error)]
pub enum Error {
    /// The API returned a structured error envelope with a non-2xx status.
    #[error("settlekit api error [{status}] {code}: {message}")]
    Api {
        /// Machine-readable error code (e.g. `not_found`, `validation_error`).
        code: String,
        /// Human-readable error message.
        message: String,
        /// The HTTP status code the API responded with.
        status: u16,
        /// Optional structured details supplied by the API.
        details: Option<BTreeMap<String, serde_json::Value>>,
    },

    /// A transport-level failure from the underlying HTTP client.
    #[error("http transport error: {0}")]
    Http(#[from] reqwest::Error),

    /// The response body could not be decoded into the expected type.
    #[error("failed to decode response body: {0}")]
    Decode(#[from] serde_json::Error),
}

impl Error {
    /// Construct an [`Error::Api`] from a decoded error envelope and status.
    pub(crate) fn from_envelope(status: u16, body: ApiErrorBody) -> Self {
        Error::Api {
            code: body.error.code,
            message: body.error.message,
            status,
            details: body.error.details,
        }
    }

    /// The machine-readable error code, when this is an [`Error::Api`].
    pub fn code(&self) -> Option<&str> {
        match self {
            Error::Api { code, .. } => Some(code),
            _ => None,
        }
    }

    /// The HTTP status, when this is an [`Error::Api`].
    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api { status, .. } => Some(*status),
            _ => None,
        }
    }
}

/// The on-the-wire error envelope: `{ "error": { code, message, details? } }`.
#[derive(Debug, Deserialize)]
pub(crate) struct ApiErrorBody {
    pub error: ApiErrorDetail,
}

/// The inner error object of the API error envelope.
#[derive(Debug, Deserialize)]
pub(crate) struct ApiErrorDetail {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub details: Option<BTreeMap<String, serde_json::Value>>,
}
