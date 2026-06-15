//! Entitlement (access) resource (`/v1/entitlements`).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::{Client, Entitlement, Result};

/// Accessor for entitlement operations.
#[derive(Debug)]
pub struct Entitlements<'a> {
    client: &'a Client,
}

/// Body for verifying access (`POST /v1/entitlements/verify`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAccess {
    pub customer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_credits: Option<i64>,
}

/// Outcome of an access verification.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    /// Whether access is granted.
    #[serde(default)]
    pub granted: bool,
    /// Any additional fields the API returns (reason, credits, etc.).
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Body for spending credits (`POST /v1/entitlements/spend-credits`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendCredits {
    pub customer_id: String,
    pub product_id: String,
    pub amount: i64,
}

#[derive(Debug, Serialize)]
struct RevokeBody<'r> {
    reason: &'r str,
}

impl<'a> Entitlements<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Entitlements { client }
    }

    /// List a customer's entitlements, optionally active-only / per product.
    pub async fn list(
        &self,
        customer_id: &str,
        active_only: bool,
        product_id: Option<&str>,
    ) -> Result<Vec<Entitlement>> {
        let mut path = format!(
            "/v1/entitlements?customerId={}&activeOnly={}",
            encode(customer_id),
            active_only
        );
        if let Some(pid) = product_id {
            path.push_str(&format!("&productId={}", encode(pid)));
        }
        self.client.request_no_body(Method::GET, &path).await
    }

    /// Verify access for a customer (feature flag / credits / product).
    pub async fn verify(&self, body: &VerifyAccess) -> Result<VerifyResult> {
        self.client
            .request(Method::POST, "/v1/entitlements/verify", Some(body))
            .await
    }

    /// Spend credits against a product entitlement.
    pub async fn spend_credits(&self, body: &SpendCredits) -> Result<Entitlement> {
        self.client
            .request(Method::POST, "/v1/entitlements/spend-credits", Some(body))
            .await
    }

    /// Fetch an entitlement by id.
    pub async fn get(&self, id: &str) -> Result<Entitlement> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/entitlements/{id}"))
            .await
    }

    /// Revoke an entitlement with a reason.
    pub async fn revoke(&self, id: &str, reason: &str) -> Result<Entitlement> {
        let body = RevokeBody { reason };
        self.client
            .request(Method::POST, &format!("/v1/entitlements/{id}/revoke"), Some(&body))
            .await
    }
}

/// Minimal, dependency-free percent-encoding for query-string values.
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
