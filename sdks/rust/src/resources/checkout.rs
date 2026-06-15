//! Checkout-session resource (`/v1/checkout-sessions`).

use std::collections::BTreeMap;

use reqwest::Method;
use serde::Serialize;

use crate::{CheckoutSession, Client, Result};

/// Accessor for checkout-session operations.
#[derive(Debug)]
pub struct Checkout<'a> {
    client: &'a Client,
}

/// A line item in a checkout-session creation request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutItem {
    pub price_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<i64>,
}

/// Body for creating a checkout session (`POST /v1/checkout-sessions`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutSession {
    pub organization_id: String,
    pub merchant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
    pub items: Vec<CheckoutItem>,
    pub pay_to_address: String,
    pub network: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collected_fields: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_days: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectFields {
    fields: BTreeMap<String, String>,
}

impl<'a> Checkout<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Checkout { client }
    }

    /// Create a checkout session.
    pub async fn create(&self, body: &CreateCheckoutSession) -> Result<CheckoutSession> {
        self.client
            .request(Method::POST, "/v1/checkout-sessions", Some(body))
            .await
    }

    /// Fetch a checkout session by id.
    pub async fn get(&self, id: &str) -> Result<CheckoutSession> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/checkout-sessions/{id}"))
            .await
    }

    /// Merge buyer-supplied delivery fields into an open session.
    pub async fn collect_fields(
        &self,
        id: &str,
        fields: BTreeMap<String, String>,
    ) -> Result<CheckoutSession> {
        let body = CollectFields { fields };
        self.client
            .request(
                Method::POST,
                &format!("/v1/checkout-sessions/{id}/collect-fields"),
                Some(&body),
            )
            .await
    }

    /// Cancel an open checkout session.
    pub async fn cancel(&self, id: &str) -> Result<CheckoutSession> {
        self.client
            .request::<_, ()>(
                Method::POST,
                &format!("/v1/checkout-sessions/{id}/cancel"),
                None,
            )
            .await
    }

    /// Expire an open checkout session.
    pub async fn expire(&self, id: &str) -> Result<CheckoutSession> {
        self.client
            .request::<_, ()>(
                Method::POST,
                &format!("/v1/checkout-sessions/{id}/expire"),
                None,
            )
            .await
    }
}
