//! Axum router, shared application state, and request handlers.
//!
//! Each verification handler first consults the TTL cache keyed by a stable
//! hash of the request. On a miss it calls the upstream SettleKit client,
//! caches the boolean result, and reports whether the response was served from
//! cache via the `cached` field.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::cache::TtlCache;
use crate::client::SettleKitClient;
use crate::error::GatewayError;

/// Shared, cheaply-cloneable application state injected into handlers.
#[derive(Clone)]
pub struct AppState {
    /// Upstream SettleKit verification client.
    pub client: SettleKitClient,
    /// TTL cache of verification booleans keyed by request hash.
    pub cache: TtlCache<bool>,
}

/// Build the full application router with all routes wired to `state`.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/verify/license", post(verify_license))
        .route("/verify/api-key", post(verify_api_key))
        .route("/verify/entitlement", post(verify_entitlement))
        .with_state(Arc::new(state))
}

/// Liveness/readiness probe.
async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

// ---------------------------------------------------------------------------
// License verification
// ---------------------------------------------------------------------------

/// Request body for `POST /verify/license`.
#[derive(Debug, Deserialize)]
struct LicenseRequest {
    license_key: String,
    product_id: String,
    machine_id: String,
}

/// Response body for `POST /verify/license`.
#[derive(Debug, Serialize)]
struct LicenseResponse {
    active: bool,
    cached: bool,
}

async fn verify_license(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LicenseRequest>,
) -> Result<Json<LicenseResponse>, GatewayError> {
    require_non_empty("license_key", &req.license_key)?;
    require_non_empty("product_id", &req.product_id)?;
    require_non_empty("machine_id", &req.machine_id)?;

    let key = cache_key(
        "license",
        &[&req.license_key, &req.product_id, &req.machine_id],
    );

    if let Some(active) = state.cache.get(&key) {
        return Ok(Json(LicenseResponse {
            active,
            cached: true,
        }));
    }

    let active = state
        .client
        .verify_license(&req.license_key, &req.product_id, &req.machine_id)
        .await?;
    state.cache.insert(key, active);

    Ok(Json(LicenseResponse {
        active,
        cached: false,
    }))
}

// ---------------------------------------------------------------------------
// API key verification
// ---------------------------------------------------------------------------

/// Request body for `POST /verify/api-key`.
#[derive(Debug, Deserialize)]
struct ApiKeyRequest {
    key: String,
    #[serde(default)]
    required_scopes: Vec<String>,
}

/// Response body for `POST /verify/api-key`.
#[derive(Debug, Serialize)]
struct ApiKeyResponse {
    valid: bool,
    cached: bool,
}

async fn verify_api_key(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ApiKeyRequest>,
) -> Result<Json<ApiKeyResponse>, GatewayError> {
    require_non_empty("key", &req.key)?;

    // Scopes participate in the cache key; sort a copy so order doesn't matter.
    let mut scopes = req.required_scopes.clone();
    scopes.sort();
    let scope_blob = scopes.join(",");
    let key = cache_key("api-key", &[&req.key, &scope_blob]);

    if let Some(valid) = state.cache.get(&key) {
        return Ok(Json(ApiKeyResponse {
            valid,
            cached: true,
        }));
    }

    let valid = state
        .client
        .verify_api_key(&req.key, &req.required_scopes)
        .await?;
    state.cache.insert(key, valid);

    Ok(Json(ApiKeyResponse {
        valid,
        cached: false,
    }))
}

// ---------------------------------------------------------------------------
// Entitlement verification
// ---------------------------------------------------------------------------

/// Request body for `POST /verify/entitlement`.
#[derive(Debug, Deserialize)]
struct EntitlementRequest {
    customer_id: String,
    feature: String,
}

/// Response body for `POST /verify/entitlement`.
#[derive(Debug, Serialize)]
struct EntitlementResponse {
    allowed: bool,
    cached: bool,
}

async fn verify_entitlement(
    State(state): State<Arc<AppState>>,
    Json(req): Json<EntitlementRequest>,
) -> Result<Json<EntitlementResponse>, GatewayError> {
    require_non_empty("customer_id", &req.customer_id)?;
    require_non_empty("feature", &req.feature)?;

    let key = cache_key("entitlement", &[&req.customer_id, &req.feature]);

    if let Some(allowed) = state.cache.get(&key) {
        return Ok(Json(EntitlementResponse {
            allowed,
            cached: true,
        }));
    }

    let allowed = state
        .client
        .verify_entitlement(&req.customer_id, &req.feature)
        .await?;
    state.cache.insert(key, allowed);

    Ok(Json(EntitlementResponse {
        allowed,
        cached: false,
    }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Reject empty/whitespace-only required string fields with a clear error.
fn require_non_empty(field: &str, value: &str) -> Result<(), GatewayError> {
    if value.trim().is_empty() {
        Err(GatewayError::BadRequest(format!(
            "field '{field}' must not be empty"
        )))
    } else {
        Ok(())
    }
}

/// Build a stable cache key from a namespace and its component parts.
///
/// Parts are length-prefixed before hashing so that ambiguous concatenations
/// (e.g. `"ab" + "c"` vs `"a" + "bc"`) cannot collide.
fn cache_key(namespace: &str, parts: &[&str]) -> String {
    let mut hasher = DefaultHasher::new();
    namespace.hash(&mut hasher);
    for part in parts {
        part.len().hash(&mut hasher);
        part.hash(&mut hasher);
    }
    format!("{namespace}:{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_collision_resistant() {
        let a = cache_key("ns", &["ab", "c"]);
        let b = cache_key("ns", &["a", "bc"]);
        assert_ne!(a, b);
    }

    #[test]
    fn cache_key_is_deterministic() {
        let a = cache_key("license", &["k", "p", "m"]);
        let b = cache_key("license", &["k", "p", "m"]);
        assert_eq!(a, b);
    }

    #[test]
    fn empty_field_rejected() {
        assert!(require_non_empty("x", "  ").is_err());
        assert!(require_non_empty("x", "ok").is_ok());
    }
}
