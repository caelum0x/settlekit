//! Analytics resource (`/v1/analytics`) — the merchant dashboard summary.

use reqwest::Method;
use serde::Deserialize;

use crate::{Client, Money, Result};

/// Accessor for analytics operations.
#[derive(Debug)]
pub struct Analytics<'a> {
    client: &'a Client,
}

/// One day in the analytics revenue series.
#[derive(Debug, Clone, Deserialize)]
pub struct RevenuePoint {
    pub date: String,
    pub amount: f64,
}

/// The live merchant dashboard summary (`GET /v1/analytics/summary`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub revenue: Money,
    pub customers: i64,
    pub active_access: i64,
    pub expiring_subscriptions: i64,
    pub failed_deliveries: i64,
    pub mrr: Money,
    pub revenue_series: Vec<RevenuePoint>,
}

impl<'a> Analytics<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Analytics { client }
    }

    /// Fetch the dashboard summary for an organization (pass `None` for the
    /// platform default org).
    pub async fn summary(&self, organization_id: Option<&str>) -> Result<AnalyticsSummary> {
        let path = match organization_id {
            Some(org) => format!("/v1/analytics/summary?organizationId={org}"),
            None => "/v1/analytics/summary".to_string(),
        };
        self.client.request_no_body(Method::GET, &path).await
    }
}
