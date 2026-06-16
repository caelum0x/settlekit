//! Webhook resource (`/v1/webhooks`) — endpoint registration, event emission,
//! and — most importantly — **signature verification** for delivered events.
//!
//! SettleKit signs every delivery Stripe-style. The `SettleKit-Signature` header
//! carries `t=<unix-seconds>,v1=<hex hmac-sha256("<t>.<raw body>", signing_secret)>`.
//! Always verify against the *raw* request bytes you received — never a
//! re-serialized copy of the parsed JSON, since key order and whitespace matter.
//!
//! ```no_run
//! use settlekit::resources::webhooks;
//!
//! // In your HTTP handler, with the raw body bytes and the header value:
//! # let raw_body = b"{}";
//! # let header = "t=1,v1=ab";
//! # let secret = "whsec_...";
//! if webhooks::verify_signature(secret, raw_body, header) {
//!     // trusted: parse and handle the event
//! }
//! ```

use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::{Client, Result};

type HmacSha256 = Hmac<Sha256>;

/// The HTTP header carrying the webhook signature on delivered events.
pub const SIGNATURE_HEADER: &str = "SettleKit-Signature";

/// Default replay-protection window: a signed timestamp older than this (or
/// further than this in the future) is rejected by [`verify_signature`].
pub const DEFAULT_TOLERANCE_SECONDS: i64 = 300;

/// A registered webhook delivery target (`GET`/`POST /v1/webhooks/endpoints`).
///
/// `signing_secret` is returned only when the endpoint is first created — store
/// it securely and use it with [`verify_signature`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEndpoint {
    pub id: String,
    pub organization_id: String,
    pub url: String,
    pub enabled_events: Vec<String>,
    pub status: String,
    #[serde(default)]
    pub signing_secret: Option<String>,
    pub created_at: String,
}

/// A webhook event, as emitted to matching endpoints.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEvent {
    pub id: String,
    #[serde(default)]
    pub organization_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: serde_json::Value,
    pub created_at: String,
}

/// Body for registering a webhook endpoint (`POST /v1/webhooks/endpoints`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWebhookEndpoint {
    pub organization_id: String,
    pub url: String,
    pub enabled_events: Vec<String>,
}

/// Body for emitting a webhook event (`POST /v1/webhooks/events`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitEvent {
    pub organization_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: serde_json::Value,
}

/// Accessor for webhook operations.
#[derive(Debug)]
pub struct Webhooks<'a> {
    client: &'a Client,
}

impl<'a> Webhooks<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Webhooks { client }
    }

    /// Register a webhook endpoint. The returned [`WebhookEndpoint`] carries the
    /// `signing_secret` (shown once) — persist it for [`verify_signature`].
    pub async fn create_endpoint(&self, body: &CreateWebhookEndpoint) -> Result<WebhookEndpoint> {
        self.client
            .request(Method::POST, "/v1/webhooks/endpoints", Some(body))
            .await
    }

    /// Emit an event to the organization's matching endpoints.
    pub async fn emit(&self, body: &EmitEvent) -> Result<WebhookEvent> {
        self.client
            .request(Method::POST, "/v1/webhooks/events", Some(body))
            .await
    }
}

/// Compute the `t=<ts>,v1=<hex>` signature for a raw body at `timestamp`
/// (unix seconds) with `secret`. This is exactly what SettleKit sends in the
/// `SettleKit-Signature` header — useful for tests and replaying deliveries.
pub fn compute_signature(secret: &str, body: &[u8], timestamp: i64) -> String {
    let v1 = sign(secret, timestamp, body);
    format!("t={timestamp},v1={v1}")
}

/// Verify the `SettleKit-Signature` header against the raw body using the
/// default replay window ([`DEFAULT_TOLERANCE_SECONDS`]). The comparison is
/// constant-time. Returns `false` on a missing/malformed header, a stale
/// timestamp, or any HMAC mismatch.
pub fn verify_signature(secret: &str, body: &[u8], header: &str) -> bool {
    verify_signature_with_tolerance(secret, body, header, DEFAULT_TOLERANCE_SECONDS)
}

/// Like [`verify_signature`] but with an explicit replay window in seconds.
/// Pass `tolerance_seconds <= 0` to skip the timestamp/replay check entirely
/// (e.g. when verifying a fixture with a fixed timestamp).
pub fn verify_signature_with_tolerance(
    secret: &str,
    body: &[u8],
    header: &str,
    tolerance_seconds: i64,
) -> bool {
    let (timestamp, v1) = match parse_header(header) {
        Some(parts) => parts,
        None => return false,
    };

    if tolerance_seconds > 0 {
        let ts: i64 = match timestamp.parse() {
            Ok(ts) => ts,
            Err(_) => return false,
        };
        let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_secs() as i64,
            Err(_) => return false,
        };
        if (now - ts).abs() > tolerance_seconds {
            return false;
        }
    }

    let provided = match hex::decode(v1) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };

    // Constant-time verification via the HMAC crate's `verify_slice`.
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    mac.verify_slice(&provided).is_ok()
}

/// Compute the lowercase-hex HMAC-SHA256 of `"<timestamp>.<body>"`.
fn sign(secret: &str, timestamp: i64, body: &[u8]) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

/// Parse `t=<ts>,v1=<hex>` into its `(t, v1)` parts, ignoring unknown segments.
fn parse_header(header: &str) -> Option<(&str, &str)> {
    let mut t = None;
    let mut v1 = None;
    for segment in header.split(',') {
        let segment = segment.trim();
        match segment.split_once('=') {
            Some(("t", value)) => t = Some(value),
            Some(("v1", value)) => v1 = Some(value),
            _ => {}
        }
    }
    match (t, v1) {
        (Some(t), Some(v1)) if !t.is_empty() && !v1.is_empty() => Some((t, v1)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "whsec_test";
    const BODY: &[u8] = br#"{"id":"evt_1"}"#;

    #[test]
    fn round_trips() {
        let header = compute_signature(SECRET, BODY, 1_781_610_000);
        assert!(verify_signature_with_tolerance(SECRET, BODY, &header, 0));
    }

    #[test]
    fn matches_cross_language_vector() {
        // Same (secret, body, ts) the Go/TS/Python SDKs produce.
        let header = compute_signature(SECRET, BODY, 1_781_610_000);
        assert_eq!(
            header,
            "t=1781610000,v1=e791667f98dea1c44358011712c97c4518ba49eaad14afed581043377e20ec9e"
        );
    }

    #[test]
    fn rejects_wrong_secret() {
        let header = compute_signature(SECRET, BODY, 1_781_610_000);
        assert!(!verify_signature_with_tolerance("nope", BODY, &header, 0));
    }

    #[test]
    fn rejects_tampered_body() {
        let header = compute_signature(SECRET, BODY, 1_781_610_000);
        assert!(!verify_signature_with_tolerance(SECRET, b"{}", &header, 0));
    }

    #[test]
    fn rejects_stale_timestamp() {
        let header = compute_signature(SECRET, BODY, 1_000_000_000);
        assert!(!verify_signature(SECRET, BODY, &header));
    }

    #[test]
    fn rejects_malformed_header() {
        assert!(!verify_signature_with_tolerance(SECRET, BODY, "garbage", 0));
        assert!(!verify_signature_with_tolerance(SECRET, BODY, "t=1", 0));
        assert!(!verify_signature_with_tolerance(SECRET, BODY, "v1=ab", 0));
    }
}
