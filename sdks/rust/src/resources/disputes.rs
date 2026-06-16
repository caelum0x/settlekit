//! Dispute resource (`/v1/disputes`).
//!
//! A dispute is opened against a confirmed payment, evidence is submitted while
//! it is `open`/`under_review`, and it is resolved with an outcome.

use reqwest::Method;
use serde::Serialize;

use crate::{Client, Dispute, Result};

/// Accessor for dispute operations.
#[derive(Debug)]
pub struct Disputes<'a> {
    client: &'a Client,
}

/// Body for opening a dispute (`POST /v1/disputes`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDispute {
    pub payment_id: String,
    pub customer_id: String,
    /// One of: `fraud`, `not_received`, `duplicate`, `quality`, `unrecognized`.
    pub reason: String,
}

/// Body for submitting evidence (`POST /v1/disputes/:id/evidence`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitEvidence {
    /// One of: `text`, `receipt`, `shipping`, `communication`, `url`, `file`.
    pub kind: String,
    pub description: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolveBody<'r> {
    outcome: &'r str,
}

impl<'a> Disputes<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Disputes { client }
    }

    /// List disputes, optionally filtered by status (pass `None` for all).
    pub async fn list(&self, status: Option<&str>) -> Result<Vec<Dispute>> {
        let path = match status {
            Some(s) => format!("/v1/disputes?status={}", encode(s)),
            None => "/v1/disputes".to_string(),
        };
        self.client.request_no_body(Method::GET, &path).await
    }

    /// Open a dispute against a payment.
    pub async fn open(&self, body: &OpenDispute) -> Result<Dispute> {
        self.client
            .request(Method::POST, "/v1/disputes", Some(body))
            .await
    }

    /// Retrieve a dispute by id.
    pub async fn retrieve(&self, id: &str) -> Result<Dispute> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/disputes/{id}"))
            .await
    }

    /// Submit a piece of evidence for a dispute.
    pub async fn submit_evidence(&self, id: &str, body: &SubmitEvidence) -> Result<Dispute> {
        self.client
            .request(
                Method::POST,
                &format!("/v1/disputes/{id}/evidence"),
                Some(body),
            )
            .await
    }

    /// Resolve a dispute with an outcome (`won` / `lost` / `refunded`).
    pub async fn resolve(&self, id: &str, outcome: &str) -> Result<Dispute> {
        let body = ResolveBody { outcome };
        self.client
            .request(
                Method::POST,
                &format!("/v1/disputes/{id}/resolve"),
                Some(&body),
            )
            .await
    }
}

/// Minimal percent-encoding for query-string values.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
