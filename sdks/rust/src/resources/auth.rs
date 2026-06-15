//! Public authentication resource (`/v1/auth`).
//!
//! These endpoints live outside the API-key-guarded group. Sign-up / sign-in
//! return a `sessionToken`; the session-scoped endpoints ([`Auth::session`] and
//! [`Auth::logout`]) authenticate with that token via a one-off request that
//! sends `Authorization: Bearer <sessionToken>` instead of the client's API key.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::{Client, Result};

/// Accessor for public authentication operations.
#[derive(Debug)]
pub struct Auth<'a> {
    client: &'a Client,
}

/// An authenticated account as returned by the auth API.
#[derive(Debug, Clone, Deserialize)]
pub struct Account {
    #[serde(flatten)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

/// Result of a successful sign-up / sign-in: account + opaque session token.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResult {
    pub account: Account,
    pub session_token: String,
}

/// Body for registering an account (`POST /v1/auth/register`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Register {
    pub email: String,
    pub password: String,
    /// `merchant` or `customer`.
    #[serde(rename = "type")]
    pub account_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// Body for logging in (`POST /v1/auth/login`).
#[derive(Debug, Clone, Serialize)]
pub struct Login {
    pub email: String,
    pub password: String,
}

/// Result of requesting a magic link.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicLinkRequestResult {
    pub ok: bool,
    /// Present only when no email transport is configured (dev mode).
    #[serde(default)]
    pub dev_token: Option<String>,
}

/// Result of resolving the current session.
#[derive(Debug, Clone, Deserialize)]
pub struct SessionInfo {
    pub account: Account,
}

#[derive(Debug, Serialize)]
struct EmailBody<'r> {
    email: &'r str,
}

#[derive(Debug, Serialize)]
struct TokenBody<'r> {
    token: &'r str,
}

#[derive(Debug, Deserialize)]
struct OkResult {
    #[allow(dead_code)]
    ok: bool,
}

impl<'a> Auth<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Auth { client }
    }

    /// Register a password account and open a session.
    pub async fn register(&self, body: &Register) -> Result<SessionResult> {
        self.client
            .request(Method::POST, "/v1/auth/register", Some(body))
            .await
    }

    /// Verify credentials and open a session.
    pub async fn login(&self, body: &Login) -> Result<SessionResult> {
        self.client
            .request(Method::POST, "/v1/auth/login", Some(body))
            .await
    }

    /// Request a single-use magic-link sign-in token.
    pub async fn request_magic_link(&self, email: &str) -> Result<MagicLinkRequestResult> {
        let body = EmailBody { email };
        self.client
            .request(Method::POST, "/v1/auth/magic-link/request", Some(&body))
            .await
    }

    /// Complete a magic-link sign-in by consuming the token.
    pub async fn complete_magic_link(&self, token: &str) -> Result<SessionResult> {
        let body = TokenBody { token };
        self.client
            .request(Method::POST, "/v1/auth/magic-link/complete", Some(&body))
            .await
    }

    /// Resolve the account for a presented session token.
    pub async fn session(&self, session_token: &str) -> Result<SessionInfo> {
        self.client
            .request_with_bearer(Method::GET, "/v1/auth/session", session_token)
            .await
    }

    /// Revoke a session token (idempotent).
    pub async fn logout(&self, session_token: &str) -> Result<()> {
        let _: OkResult = self
            .client
            .request_with_bearer(Method::POST, "/v1/auth/logout", session_token)
            .await?;
        Ok(())
    }
}
