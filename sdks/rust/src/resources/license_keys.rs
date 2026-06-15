//! License-key resource (`/v1/license-keys`).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::{Client, LicenseKey, Result};

/// Accessor for license-key operations.
#[derive(Debug)]
pub struct LicenseKeys<'a> {
    client: &'a Client,
}

/// Body for issuing a license key (`POST /v1/license-keys`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueLicenseKey {
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub entitlement_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// Body for verifying a license key (`POST /v1/license-keys/verify`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLicenseKey {
    pub license_key: String,
    pub product_id: String,
    pub machine_id: String,
}

/// An offline validation token minted for a license key.
#[derive(Debug, Clone, Deserialize)]
pub struct LicenseToken {
    pub token: String,
}

impl<'a> LicenseKeys<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        LicenseKeys { client }
    }

    /// Issue a new license key.
    pub async fn issue(&self, body: &IssueLicenseKey) -> Result<LicenseKey> {
        self.client
            .request(Method::POST, "/v1/license-keys", Some(body))
            .await
    }

    /// Verify a license key for a product + machine. The deserialized result
    /// captures the API's verification payload.
    pub async fn verify(&self, body: &VerifyLicenseKey) -> Result<serde_json::Value> {
        self.client
            .request(Method::POST, "/v1/license-keys/verify", Some(body))
            .await
    }

    /// Mint an offline validation token for an existing license.
    pub async fn issue_token(&self, id: &str) -> Result<LicenseToken> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/license-keys/{id}/token"), None)
            .await
    }

    /// Revoke a license key.
    pub async fn revoke(&self, id: &str) -> Result<LicenseKey> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/license-keys/{id}/revoke"), None)
            .await
    }
}
