//! Error types for the Arc indexer.
//!
//! A single [`IndexerError`] enum unifies configuration, transport, decoding and
//! API errors so the rest of the binary can use `Result<T>` everywhere and bubble
//! failures up to the top-level loop with a clear, human-readable message.

use thiserror::Error;

/// Convenience result alias used throughout the crate.
pub type Result<T> = std::result::Result<T, IndexerError>;

/// Every failure mode the indexer can encounter.
#[derive(Debug, Error)]
pub enum IndexerError {
    /// A required environment variable was missing or empty.
    #[error("missing required environment variable: {0}")]
    MissingEnv(String),

    /// An environment variable held a value that could not be parsed.
    #[error("invalid value for environment variable {name}: {reason}")]
    InvalidEnv { name: String, reason: String },

    /// The HTTP transport (reqwest) failed.
    #[error("http transport error: {0}")]
    Http(#[from] reqwest::Error),

    /// A JSON-RPC endpoint returned an `error` object.
    #[error("json-rpc error {code}: {message}")]
    Rpc { code: i64, message: String },

    /// A JSON-RPC response was structurally valid but missing its `result`.
    #[error("json-rpc response had no result for method {0}")]
    EmptyResult(String),

    /// A hex string could not be decoded.
    #[error("hex decode error: {0}")]
    Hex(#[from] hex::FromHexError),

    /// A hex-quantity (e.g. block number) could not be parsed.
    #[error("invalid hex quantity {value:?}: {reason}")]
    InvalidQuantity { value: String, reason: String },

    /// A log entry did not match the expected ERC-20 Transfer shape.
    #[error("malformed transfer log: {0}")]
    MalformedLog(String),

    /// The SettleKit API rejected a confirmation request.
    #[error("settlekit api error (status {status}): {code}: {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
    },

    /// JSON (de)serialization failed.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}
