//! Payment resource (`/v1/payments`).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::{Client, Entitlement, Payment, Result};

/// Accessor for payment lifecycle operations.
#[derive(Debug)]
pub struct Payments<'a> {
    client: &'a Client,
}

/// Body for recording a pending payment (`POST /v1/payments`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPayment {
    pub checkout_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
}

/// Body for confirming a payment (`POST /v1/payments/:id/confirm`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmPayment {
    pub tx_hash: String,
    pub confirmations: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_confirmations: Option<i64>,
}

/// Result of confirming a payment: the payment plus any granted entitlements.
#[derive(Debug, Clone, Deserialize)]
pub struct ConfirmResult {
    pub payment: Payment,
    #[serde(default)]
    pub entitlements: Vec<Entitlement>,
}

impl<'a> Payments<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Payments { client }
    }

    /// Record a pending payment against a checkout session.
    pub async fn record(&self, body: &RecordPayment) -> Result<Payment> {
        self.client
            .request(Method::POST, "/v1/payments", Some(body))
            .await
    }

    /// Fetch a payment by id.
    pub async fn get(&self, id: &str) -> Result<Payment> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/payments/{id}"))
            .await
    }

    /// Confirm a payment, completing its session and granting entitlements.
    pub async fn confirm(&self, id: &str, body: &ConfirmPayment) -> Result<ConfirmResult> {
        self.client
            .request(Method::POST, &format!("/v1/payments/{id}/confirm"), Some(body))
            .await
    }

    /// Fail a pending payment.
    pub async fn fail(&self, id: &str) -> Result<Payment> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/payments/{id}/fail"), None)
            .await
    }

    /// Refund a confirmed payment.
    pub async fn refund(&self, id: &str) -> Result<Payment> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/payments/{id}/refund"), None)
            .await
    }
}
