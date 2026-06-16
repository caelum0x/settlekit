//! Dunning resource (`/v1/dunning`).
//!
//! Dunning recovers failed subscription payments: start a campaign for a
//! subscription, record attempt outcomes, and recover (or let it exhaust).

use reqwest::Method;
use serde::Serialize;

use crate::{Client, DunningState, Result};

/// Accessor for dunning operations.
#[derive(Debug)]
pub struct Dunning<'a> {
    client: &'a Client,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartBody<'r> {
    subscription_id: &'r str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttemptBody<'r> {
    outcome: &'r str,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_reason: Option<&'r str>,
}

impl<'a> Dunning<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Dunning { client }
    }

    /// List active dunning campaigns, or only those due when `due_only`.
    pub async fn list(&self, due_only: bool) -> Result<Vec<DunningState>> {
        let path = if due_only {
            "/v1/dunning?due=true"
        } else {
            "/v1/dunning"
        };
        self.client.request_no_body(Method::GET, path).await
    }

    /// Start a dunning campaign for a subscription with a failed payment.
    pub async fn start(&self, subscription_id: &str) -> Result<DunningState> {
        let body = StartBody { subscription_id };
        self.client
            .request(Method::POST, "/v1/dunning", Some(&body))
            .await
    }

    /// Record an attempt outcome (`recovered` / `failed`). `recovered` closes
    /// the campaign; `failed` advances or exhausts it.
    pub async fn attempt(
        &self,
        subscription_id: &str,
        outcome: &str,
        failure_reason: Option<&str>,
    ) -> Result<DunningState> {
        let body = AttemptBody {
            outcome,
            failure_reason,
        };
        self.client
            .request(
                Method::POST,
                &format!("/v1/dunning/{subscription_id}/attempt"),
                Some(&body),
            )
            .await
    }

    /// Mark a subscription's dunning campaign as recovered.
    pub async fn recover(&self, subscription_id: &str) -> Result<DunningState> {
        self.client
            .request::<_, ()>(
                Method::POST,
                &format!("/v1/dunning/{subscription_id}/recover"),
                None,
            )
            .await
    }
}
