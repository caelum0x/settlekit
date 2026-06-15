//! SettleKit API client for posting payment confirmations.
//!
//! The SettleKit REST API confirms a payment via:
//!   `POST {API_URL}/v1/payments/{paymentId}/confirm`
//! authenticated with `Authorization: Bearer <apiKey>`. The request body matches
//! the API's confirm schema:
//!   `{ "txHash": string, "confirmations": number, "minConfirmations"?: number }`
//! and we additionally include the on-chain `from` and `amount` for traceability
//! (the API ignores unknown fields).
//!
//! Success responses use a `{ "data": ... }` envelope; failures use
//! `{ "error": { "code", "message", "details"? } }` with the HTTP status carrying
//! the error. We surface API failures as [`IndexerError::Api`].

use serde::{Deserialize, Serialize};

use crate::error::{IndexerError, Result};

/// Request body sent to the confirm endpoint.
#[derive(Debug, Serialize)]
struct ConfirmRequest<'a> {
    #[serde(rename = "txHash")]
    tx_hash: &'a str,
    confirmations: u64,
    #[serde(rename = "minConfirmations")]
    min_confirmations: u64,
    /// On-chain sender (extra context; ignored by the API schema).
    from: &'a str,
    /// On-chain amount in base units, as a decimal string to avoid precision loss.
    amount: String,
}

/// The error envelope returned by the SettleKit API on failure.
#[derive(Debug, Deserialize)]
struct ApiErrorEnvelope {
    error: ApiErrorBody,
}

/// Inner error object of an [`ApiErrorEnvelope`].
#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    code: String,
    message: String,
}

/// Client for the SettleKit confirmation endpoint.
#[derive(Debug, Clone)]
pub struct SettleKitClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl SettleKitClient {
    /// Construct a client. `base_url` should not have a trailing slash.
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into(),
            api_key: api_key.into(),
        }
    }

    /// Confirm a payment identified by `payment_id` with the on-chain transfer
    /// details. Returns `Ok(())` on a 2xx response; otherwise maps the error
    /// envelope (or raw body) into [`IndexerError::Api`].
    pub async fn confirm_payment(
        &self,
        payment_id: &str,
        tx_hash: &str,
        from: &str,
        amount: u128,
        confirmations: u64,
        min_confirmations: u64,
    ) -> Result<()> {
        let url = format!(
            "{}/v1/payments/{}/confirm",
            self.base_url,
            urlencode_path_segment(payment_id)
        );

        let body = ConfirmRequest {
            tx_hash,
            confirmations,
            min_confirmations,
            from,
            amount: amount.to_string(),
        };

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if status.is_success() {
            return Ok(());
        }

        let raw = resp.text().await.unwrap_or_default();
        let (code, message) = match serde_json::from_str::<ApiErrorEnvelope>(&raw) {
            Ok(env) => (env.error.code, env.error.message),
            Err(_) => (
                "unknown".to_string(),
                if raw.is_empty() {
                    "no response body".to_string()
                } else {
                    raw
                },
            ),
        };

        Err(IndexerError::Api {
            status: status.as_u16(),
            code,
            message,
        })
    }
}

/// Percent-encode the characters that are unsafe inside a single URL path
/// segment. Tx hashes are hex so this is mostly defensive, but payment ids may
/// be arbitrary strings.
fn urlencode_path_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}
