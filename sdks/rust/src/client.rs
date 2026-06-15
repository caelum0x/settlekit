//! The SettleKit HTTP client.
//!
//! [`Client`] holds the API key, base URL, and a shared [`reqwest::Client`]. All
//! resource methods (implemented in [`crate::resources`]) funnel through the
//! private [`Client::request`] method, which:
//!
//! 1. attaches `Authorization: Bearer <api_key>`,
//! 2. sets `Content-Type: application/json` and a JSON body on writes,
//! 3. adds an idempotency key header on mutating requests,
//! 4. parses the `{ data }` / `{ error }` envelope into `Result<T, Error>`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde::Serialize;

use crate::error::{ApiErrorBody, Error, Result};

/// Default base URL of a locally running SettleKit API.
pub const DEFAULT_BASE_URL: &str = "http://localhost:8787";

/// The success envelope: `{ "data": <payload> }`.
#[derive(Debug, Deserialize)]
struct DataEnvelope<T> {
    data: T,
}

/// Monotonic counter used to derive unique idempotency keys per process.
static IDEMPOTENCY_COUNTER: AtomicU64 = AtomicU64::new(0);

/// An async client for the SettleKit REST API.
///
/// Cloning is cheap: the underlying [`reqwest::Client`] uses an `Arc` internally
/// and shares its connection pool across clones.
#[derive(Debug, Clone)]
pub struct Client {
    api_key: String,
    base_url: String,
    http: reqwest::Client,
}

impl Client {
    /// Create a client targeting the default base URL ([`DEFAULT_BASE_URL`]).
    ///
    /// # Panics
    ///
    /// Panics only if the underlying TLS backend fails to initialize, which is
    /// effectively impossible on a correctly built platform.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::builder(api_key, DEFAULT_BASE_URL)
            .expect("failed to build reqwest client")
    }

    /// Override the base URL (e.g. point at a hosted environment).
    ///
    /// The trailing slash, if any, is trimmed so path joining stays uniform.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    /// Build a client, returning the constructed value or the transport error.
    fn builder(api_key: impl Into<String>, base_url: &str) -> Result<Self> {
        let http = reqwest::Client::builder().build()?;
        Ok(Client {
            api_key: api_key.into(),
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        })
    }

    /// The base URL this client targets.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Generate a process-unique idempotency key for a write request.
    fn idempotency_key() -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let seq = IDEMPOTENCY_COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("sk-idem-{now:x}-{seq:x}")
    }

    /// Perform a request without a body (typically `GET`).
    pub(crate) async fn request_no_body<T>(&self, method: Method, path: &str) -> Result<T>
    where
        T: DeserializeOwned,
    {
        self.request::<T, ()>(method, path, None).await
    }

    /// Perform a request authenticated with an explicit Bearer token instead of
    /// the client's API key (used by session-scoped `/v1/auth` endpoints).
    pub(crate) async fn request_with_bearer<T>(
        &self,
        method: Method,
        path: &str,
        bearer: &str,
    ) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let url = format!("{}{}", self.base_url, path);
        let is_write = method != Method::GET && method != Method::HEAD;

        let mut req = self.http.request(method, &url).bearer_auth(bearer);
        if is_write {
            req = req
                .header("Idempotency-Key", Self::idempotency_key())
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body("{}");
        }

        let response = req.send().await?;
        Self::parse_response(response).await
    }

    /// Perform a request, optionally serializing `body` as JSON, and parse the
    /// `{ data }` / `{ error }` envelope.
    ///
    /// On any non-`GET` method an `Idempotency-Key` header is attached so the
    /// API can safely de-duplicate retried writes.
    pub(crate) async fn request<T, B>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<T>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let url = format!("{}{}", self.base_url, path);
        let is_write = method != Method::GET && method != Method::HEAD;

        let mut req = self
            .http
            .request(method, &url)
            .bearer_auth(&self.api_key);

        if is_write {
            req = req.header("Idempotency-Key", Self::idempotency_key());
        }

        if let Some(payload) = body {
            // `.json()` sets Content-Type: application/json and serializes.
            req = req.json(payload);
        } else if is_write {
            // Ensure writes without an explicit body still send valid JSON.
            req = req
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body("{}");
        }

        let response = req.send().await?;
        Self::parse_response(response).await
    }

    /// Parse a response into the `{ data }` payload or an [`Error`].
    async fn parse_response<T>(response: reqwest::Response) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let status = response.status();
        let bytes = response.bytes().await?;

        if status.is_success() {
            let envelope: DataEnvelope<T> = serde_json::from_slice(&bytes)?;
            return Ok(envelope.data);
        }

        // Non-2xx: decode the structured error envelope when possible.
        match serde_json::from_slice::<ApiErrorBody>(&bytes) {
            Ok(body) => Err(Error::from_envelope(status.as_u16(), body)),
            Err(_) => Err(Self::fallback_error(status, &bytes)),
        }
    }

    /// Build an [`Error::Api`] when the body is not a valid error envelope.
    fn fallback_error(status: StatusCode, bytes: &[u8]) -> Error {
        let message = String::from_utf8_lossy(bytes);
        let message = if message.trim().is_empty() {
            status
                .canonical_reason()
                .unwrap_or("request failed")
                .to_string()
        } else {
            message.into_owned()
        };
        Error::Api {
            code: "http_error".to_string(),
            message,
            status: status.as_u16(),
            details: None,
        }
    }
}
