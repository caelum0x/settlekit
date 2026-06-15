//! Scoped API-key resource (`/v1/api-keys`).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::{ApiKey, Client, Result};

/// Accessor for scoped API-key operations.
#[derive(Debug)]
pub struct ApiKeys<'a> {
    client: &'a Client,
}

/// Body for issuing an API key (`POST /v1/api-keys`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueApiKey {
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub entitlement_id: String,
    pub scopes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
}

/// Issuance result: the stored key plus the one-time plaintext secret.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedApiKey {
    pub api_key: ApiKey,
    /// The plaintext secret, returned exactly once at issuance.
    pub plaintext: String,
}

/// Body for verifying an API key (`POST /v1/api-keys/verify`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyApiKey {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_scopes: Option<Vec<String>>,
}

/// Outcome of verifying a presented key.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyApiKeyResult {
    pub valid: bool,
    #[serde(default)]
    pub api_key: Option<ApiKey>,
}

#[derive(Debug, Serialize)]
struct RevokeBody<'r> {
    key: &'r str,
}

impl<'a> ApiKeys<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        ApiKeys { client }
    }

    /// Issue a new API key, returning the one-time plaintext.
    pub async fn issue(&self, body: &IssueApiKey) -> Result<IssuedApiKey> {
        self.client
            .request(Method::POST, "/v1/api-keys", Some(body))
            .await
    }

    /// Verify a presented key, optionally requiring scopes.
    pub async fn verify(&self, body: &VerifyApiKey) -> Result<VerifyApiKeyResult> {
        self.client
            .request(Method::POST, "/v1/api-keys/verify", Some(body))
            .await
    }

    /// Revoke a key by its plaintext.
    pub async fn revoke(&self, key: &str) -> Result<ApiKey> {
        let body = RevokeBody { key };
        self.client
            .request(Method::POST, "/v1/api-keys/revoke", Some(&body))
            .await
    }
}
