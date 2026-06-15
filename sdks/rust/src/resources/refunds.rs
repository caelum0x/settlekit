//! Refund resource (`/v1/refunds`).

use reqwest::Method;
use serde::Serialize;

use crate::{Client, Refund, Result};

/// Accessor for refund operations.
#[derive(Debug)]
pub struct Refunds<'a> {
    client: &'a Client,
}

/// Body for creating a refund (`POST /v1/refunds`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRefund {
    pub payment_id: String,
    pub customer_id: String,
    pub amount: String,
    /// One of: `duplicate`, `fraudulent`, `customer_request`, `delivery_failed`.
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_amount: Option<String>,
}

#[derive(Debug, Serialize)]
struct FailBody<'r> {
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'r str>,
}

impl<'a> Refunds<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Refunds { client }
    }

    /// Create a pending refund against a confirmed payment.
    pub async fn create(&self, body: &CreateRefund) -> Result<Refund> {
        self.client
            .request(Method::POST, "/v1/refunds", Some(body))
            .await
    }

    /// List refunds for a payment.
    pub async fn list_by_payment(&self, payment_id: &str) -> Result<Vec<Refund>> {
        self.client
            .request_no_body(
                Method::GET,
                &format!("/v1/refunds?paymentId={}", encode(payment_id)),
            )
            .await
    }

    /// List refunds for a customer.
    pub async fn list_by_customer(&self, customer_id: &str) -> Result<Vec<Refund>> {
        self.client
            .request_no_body(
                Method::GET,
                &format!("/v1/refunds?customerId={}", encode(customer_id)),
            )
            .await
    }

    /// Mark a pending refund as succeeded.
    pub async fn succeed(&self, id: &str) -> Result<Refund> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/refunds/{id}/succeed"), None)
            .await
    }

    /// Mark a pending refund as failed with an optional reason.
    pub async fn fail(&self, id: &str, reason: Option<&str>) -> Result<Refund> {
        let body = FailBody { reason };
        self.client
            .request(Method::POST, &format!("/v1/refunds/{id}/fail"), Some(&body))
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
