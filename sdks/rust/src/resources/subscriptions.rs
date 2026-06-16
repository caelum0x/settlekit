//! Subscription resource (`/v1/subscriptions`).
//!
//! Creating a subscription also grants a subscription entitlement for the
//! product; both are returned together by [`Subscriptions::create`].

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::{Client, Entitlement, Result, Subscription};

/// Accessor for subscription operations.
#[derive(Debug)]
pub struct Subscriptions<'a> {
    client: &'a Client,
}

/// Body for creating a subscription (`POST /v1/subscriptions`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubscription {
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub price_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_at_period_end: Option<bool>,
}

/// Result of creating a subscription: the subscription plus the entitlement it
/// granted for the product.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateSubscriptionResult {
    pub subscription: Subscription,
    pub entitlement: Entitlement,
}

impl<'a> Subscriptions<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Subscriptions { client }
    }

    /// List subscriptions for an organization (pass `None` for the platform
    /// default org).
    pub async fn list(&self, organization_id: Option<&str>) -> Result<Vec<Subscription>> {
        let path = match organization_id {
            Some(org) => format!("/v1/subscriptions?organizationId={}", encode(org)),
            None => "/v1/subscriptions".to_string(),
        };
        self.client.request_no_body(Method::GET, &path).await
    }

    /// Create a subscription from a recurring price.
    pub async fn create(&self, body: &CreateSubscription) -> Result<CreateSubscriptionResult> {
        self.client
            .request(Method::POST, "/v1/subscriptions", Some(body))
            .await
    }

    /// Retrieve a subscription by id.
    pub async fn retrieve(&self, id: &str) -> Result<Subscription> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/subscriptions/{id}"))
            .await
    }

    /// Advance a subscription to its next billing period.
    pub async fn renew(&self, id: &str) -> Result<Subscription> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/subscriptions/{id}/renew"), None)
            .await
    }

    /// Cancel a subscription.
    pub async fn cancel(&self, id: &str) -> Result<Subscription> {
        self.client
            .request::<_, ()>(
                Method::POST,
                &format!("/v1/subscriptions/{id}/cancel"),
                None,
            )
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
