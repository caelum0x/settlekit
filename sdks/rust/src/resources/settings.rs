//! Organization settings resource (`/v1/settings`).
//!
//! Reading returns defaults when unset; updating merges the provided keys over
//! the current values.

use reqwest::Method;
use serde::Serialize;

use crate::{Client, OrgSettings, Result};

/// Accessor for organization-settings operations.
#[derive(Debug)]
pub struct Settings<'a> {
    client: &'a Client,
}

/// A partial settings patch; only `Some` fields are sent. `default_rail` is one
/// of `arc`, `circle`, `x402`.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub support_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payout_currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_rail: Option<String>,
}

impl<'a> Settings<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Settings { client }
    }

    /// Read settings for an organization (pass `None` for the platform org).
    pub async fn retrieve(&self, organization_id: Option<&str>) -> Result<OrgSettings> {
        let path = match organization_id {
            Some(org) => format!("/v1/settings?organizationId={}", encode(org)),
            None => "/v1/settings".to_string(),
        };
        self.client.request_no_body(Method::GET, &path).await
    }

    /// Patch settings, merging `patch` over current values.
    pub async fn update(&self, patch: &UpdateSettings) -> Result<OrgSettings> {
        self.client
            .request(Method::POST, "/v1/settings", Some(patch))
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
