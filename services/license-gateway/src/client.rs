//! Thin async client for the SettleKit verification endpoints.
//!
//! Wraps a shared [`reqwest::Client`] and knows how to call the three verify
//! routes, unwrapping the `{ "data": T }` / `{ "error": { code, message } }`
//! envelope into typed Rust results.

use axum::http::StatusCode;
use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::config::Config;
use crate::error::GatewayError;

/// SettleKit success envelope.
#[derive(Debug, Deserialize)]
struct DataEnvelope<T> {
    data: T,
}

/// SettleKit error envelope.
#[derive(Debug, Deserialize)]
struct ErrorEnvelope {
    error: ErrorEnvelopeBody,
}

#[derive(Debug, Deserialize)]
struct ErrorEnvelopeBody {
    code: String,
    message: String,
}

/// Upstream payload for `POST /v1/license-keys/verify`.
#[derive(Debug, Serialize)]
struct LicenseVerifyBody<'a> {
    #[serde(rename = "licenseKey")]
    license_key: &'a str,
    #[serde(rename = "productId")]
    product_id: &'a str,
    #[serde(rename = "machineId")]
    machine_id: &'a str,
}

/// Upstream result for license verification.
#[derive(Debug, Deserialize)]
struct LicenseVerifyResult {
    active: bool,
}

/// Upstream payload for `POST /v1/api-keys/verify`.
#[derive(Debug, Serialize)]
struct ApiKeyVerifyBody<'a> {
    key: &'a str,
    #[serde(rename = "requiredScopes")]
    required_scopes: &'a [String],
}

/// Upstream result for API key verification.
#[derive(Debug, Deserialize)]
struct ApiKeyVerifyResult {
    valid: bool,
}

/// Upstream payload for `POST /v1/entitlements/verify`.
#[derive(Debug, Serialize)]
struct EntitlementVerifyBody<'a> {
    #[serde(rename = "customerId")]
    customer_id: &'a str,
    feature: &'a str,
}

/// Upstream result for entitlement verification.
#[derive(Debug, Deserialize)]
struct EntitlementVerifyResult {
    allowed: bool,
}

/// Async client bound to a single SettleKit deployment and API key.
#[derive(Debug, Clone)]
pub struct SettleKitClient {
    http: Client,
    base_url: String,
    api_key: String,
}

impl SettleKitClient {
    /// Build a client from validated [`Config`].
    ///
    /// The underlying connection pool is reused across requests for keep-alive
    /// performance. Fails only if the TLS backend cannot be initialized.
    pub fn new(config: &Config) -> anyhow::Result<Self> {
        let http = Client::builder()
            .timeout(config.request_timeout)
            .user_agent(concat!("license-gateway/", env!("CARGO_PKG_VERSION")))
            .build()?;

        Ok(Self {
            http,
            base_url: config.api_url.clone(),
            api_key: config.api_key.clone(),
        })
    }

    /// Verify a license key against `/v1/license-keys/verify`.
    pub async fn verify_license(
        &self,
        license_key: &str,
        product_id: &str,
        machine_id: &str,
    ) -> Result<bool, GatewayError> {
        let body = LicenseVerifyBody {
            license_key,
            product_id,
            machine_id,
        };
        let result: LicenseVerifyResult = self.post("/v1/license-keys/verify", &body).await?;
        Ok(result.active)
    }

    /// Verify an API key against `/v1/api-keys/verify`.
    pub async fn verify_api_key(
        &self,
        key: &str,
        required_scopes: &[String],
    ) -> Result<bool, GatewayError> {
        let body = ApiKeyVerifyBody {
            key,
            required_scopes,
        };
        let result: ApiKeyVerifyResult = self.post("/v1/api-keys/verify", &body).await?;
        Ok(result.valid)
    }

    /// Verify an entitlement against `/v1/entitlements/verify`.
    pub async fn verify_entitlement(
        &self,
        customer_id: &str,
        feature: &str,
    ) -> Result<bool, GatewayError> {
        let body = EntitlementVerifyBody {
            customer_id,
            feature,
        };
        let result: EntitlementVerifyResult = self.post("/v1/entitlements/verify", &body).await?;
        Ok(result.allowed)
    }

    /// Issue an authenticated POST and unwrap the SettleKit envelope into `T`.
    async fn post<B, T>(&self, path: &str, body: &B) -> Result<T, GatewayError>
    where
        B: Serialize,
        T: DeserializeOwned,
    {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(body)
            .send()
            .await
            .map_err(|e| GatewayError::Upstream(e.to_string()))?;

        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| GatewayError::Upstream(e.to_string()))?;

        if status.is_success() {
            let envelope: DataEnvelope<T> = serde_json::from_slice(&bytes)
                .map_err(|e| GatewayError::Decode(e.to_string()))?;
            return Ok(envelope.data);
        }

        // Non-2xx: try to surface the structured upstream error; fall back to a
        // generic upstream error if the body is not a recognizable envelope.
        let mapped_status = StatusCode::from_u16(status.as_u16())
            .unwrap_or(StatusCode::BAD_GATEWAY);
        match serde_json::from_slice::<ErrorEnvelope>(&bytes) {
            Ok(env) => Err(GatewayError::UpstreamApi {
                status: mapped_status,
                code: env.error.code,
                message: env.error.message,
            }),
            Err(_) => Err(GatewayError::Upstream(format!(
                "upstream returned status {} with non-envelope body",
                status.as_u16()
            ))),
        }
    }
}
