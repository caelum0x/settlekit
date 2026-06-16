//! Usage-based billing resource (`/v1/usage`) — metering + prepaid credits.

use reqwest::Method;
use serde::Serialize;

use crate::{Client, Result};

/// Accessor for usage-based billing operations.
#[derive(Debug)]
pub struct Usage<'a> {
    client: &'a Client,
}

/// Body for recording usage (`POST /v1/usage/record`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordUsage {
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub metric: String,
    pub quantity: i64,
}

/// Body for granting/consuming prepaid credits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditOp {
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub credits: i64,
}

impl<'a> Usage<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Usage { client }
    }

    /// Record usage of a metric (creates the meter on first use).
    pub async fn record(&self, body: &RecordUsage) -> Result<serde_json::Value> {
        self.client
            .request(Method::POST, "/v1/usage/record", Some(body))
            .await
    }

    /// Read a customer's prepaid credit balance for a product.
    pub async fn credits(
        &self,
        organization_id: &str,
        customer_id: &str,
        product_id: &str,
    ) -> Result<serde_json::Value> {
        let path = format!(
            "/v1/usage/credits?organizationId={}&customerId={}&productId={}",
            urlencoding(organization_id),
            urlencoding(customer_id),
            urlencoding(product_id),
        );
        self.client.request_no_body(Method::GET, &path).await
    }

    /// Grant prepaid credits.
    pub async fn grant_credits(&self, body: &CreditOp) -> Result<serde_json::Value> {
        self.client
            .request(Method::POST, "/v1/usage/credits/grant", Some(body))
            .await
    }

    /// Consume prepaid credits (meter a paid call).
    pub async fn consume_credits(&self, body: &CreditOp) -> Result<serde_json::Value> {
        self.client
            .request(Method::POST, "/v1/usage/credits/consume", Some(body))
            .await
    }
}

/// Minimal percent-encoding for query-string values (alphanumerics + a few safe
/// chars pass through; everything else is `%XX`).
fn urlencoding(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
