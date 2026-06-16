//! SettleKit API client for posting observed on-chain payments.
//!
//! When the indexer sees a USDC `Transfer` to the watched address it reports it
//! to the SettleKit **direct-payment** endpoint:
//!   `POST {API_URL}/v1/payments/observe`
//! authenticated with `Authorization: Bearer <apiKey>`. The API RE-VERIFIES the
//! transfer on-chain (it never trusts the indexer's claim), screens the sender,
//! and records a confirmed payment attributed to the organization. Request body:
//!   `{ organizationId, txHash, to, amount, asset, network, from, confirmations }`
//! where `amount` is a decimal major-unit string (USDC has 6 decimals).
//!
//! Success responses use a `{ "data": ... }` envelope; failures use
//! `{ "error": { "code", "message", "details"? } }` with the HTTP status carrying
//! the error. We surface API failures as [`IndexerError::Api`].

use serde::{Deserialize, Serialize};

use crate::error::{IndexerError, Result};

/// Request body sent to the observe endpoint.
#[derive(Debug, Serialize)]
struct ObserveRequest<'a> {
    #[serde(rename = "organizationId")]
    organization_id: &'a str,
    #[serde(rename = "txHash")]
    tx_hash: &'a str,
    /// Watched recipient address the transfer landed at.
    to: &'a str,
    /// Decimal major-unit amount (e.g. "10.5"); the API re-verifies it on-chain.
    amount: String,
    asset: &'a str,
    network: &'a str,
    /// On-chain sender; the API screens it for sanctions/risk.
    from: &'a str,
    confirmations: u64,
}

/// Format a USDC base-unit amount (6 decimals) as a decimal major-unit string.
fn format_usdc_amount(base_units: u128) -> String {
    let whole = base_units / 1_000_000;
    let frac = base_units % 1_000_000;
    if frac == 0 {
        whole.to_string()
    } else {
        let frac_str = format!("{frac:06}");
        format!("{whole}.{}", frac_str.trim_end_matches('0'))
    }
}

#[cfg(test)]
mod tests {
    use super::format_usdc_amount;

    #[test]
    fn formats_usdc_base_units_to_major_units() {
        assert_eq!(format_usdc_amount(0), "0");
        assert_eq!(format_usdc_amount(1_000_000), "1");
        assert_eq!(format_usdc_amount(25_500_000), "25.5");
        assert_eq!(format_usdc_amount(10_120_000), "10.12");
        assert_eq!(format_usdc_amount(1), "0.000001");
        assert_eq!(format_usdc_amount(123_456_789), "123.456789");
    }
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

    /// Report an observed on-chain USDC transfer to the watched address as a
    /// direct payment. The API re-verifies it on-chain and screens the sender,
    /// then records a confirmed payment for `organization_id`. Returns `Ok(())`
    /// on a 2xx response; otherwise maps the error envelope into [`IndexerError::Api`].
    pub async fn observe_payment(
        &self,
        organization_id: &str,
        tx_hash: &str,
        to: &str,
        from: &str,
        amount: u128,
        confirmations: u64,
    ) -> Result<()> {
        let url = format!("{}/v1/payments/observe", self.base_url);

        let body = ObserveRequest {
            organization_id,
            tx_hash,
            to,
            amount: format_usdc_amount(amount),
            asset: "USDC",
            network: "arc",
            from,
            confirmations,
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
