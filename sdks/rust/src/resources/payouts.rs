//! Payout (merchant settlement) resource (`/v1/payouts`).

use reqwest::Method;
use serde::Serialize;

use crate::{Client, Money, Payout, Result};

/// Accessor for payout operations.
#[derive(Debug)]
pub struct Payouts<'a> {
    client: &'a Client,
}

/// Body for creating a payout (`POST /v1/payouts`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePayout {
    pub organization_id: String,
    pub wallet_address: String,
    pub amount: String,
    /// One of: `arc`, `base`, `ethereum`.
    pub network: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaidBody<'r> {
    tx_hash: &'r str,
}

#[derive(Debug, Serialize)]
struct FailBody<'r> {
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'r str>,
}

impl<'a> Payouts<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Payouts { client }
    }

    /// Create a pending payout.
    pub async fn create(&self, body: &CreatePayout) -> Result<Payout> {
        self.client
            .request(Method::POST, "/v1/payouts", Some(body))
            .await
    }

    /// List payouts for an organization.
    pub async fn list_by_organization(&self, organization_id: &str) -> Result<Vec<Payout>> {
        self.client
            .request_no_body(
                Method::GET,
                &format!("/v1/payouts?organizationId={}", encode(organization_id)),
            )
            .await
    }

    /// Available settlement balance for an organization.
    pub async fn balance(&self, organization_id: &str) -> Result<Money> {
        self.client
            .request_no_body(
                Method::GET,
                &format!(
                    "/v1/payouts/balance?organizationId={}",
                    encode(organization_id)
                ),
            )
            .await
    }

    /// Mark a payout paid with an on-chain transaction hash.
    pub async fn mark_paid(&self, id: &str, tx_hash: &str) -> Result<Payout> {
        let body = PaidBody { tx_hash };
        self.client
            .request(Method::POST, &format!("/v1/payouts/{id}/paid"), Some(&body))
            .await
    }

    /// Mark a payout failed with an optional reason.
    pub async fn fail(&self, id: &str, reason: Option<&str>) -> Result<Payout> {
        let body = FailBody { reason };
        self.client
            .request(Method::POST, &format!("/v1/payouts/{id}/fail"), Some(&body))
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
