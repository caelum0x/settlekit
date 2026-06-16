//! Axum HTTP handlers and router.
//!
//! Endpoints:
//!   - `GET    /healthz`           liveness probe.
//!   - `POST   /subscribers`       register a subscriber.
//!   - `GET    /subscribers`       list subscribers.
//!   - `DELETE /subscribers/:id`   remove a subscriber.
//!   - `POST   /events`            accept an event, fan it out, return delivery ids.
//!   - `GET    /deliveries`        recent delivery log.
//!
//! Responses use the SettleKit envelope: success bodies are wrapped in
//! `{"data": ...}`; errors are rendered by [`crate::error::RelayError`] as
//! `{"error":{"code","message"}}`.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{RelayError, Result};
use crate::relay::Relay;
use crate::subscribers::{RegisterSubscriber, SubscriberRegistry};

/// Default number of delivery records returned by `GET /deliveries`.
const DEFAULT_DELIVERIES_LIMIT: usize = 100;
/// Hard cap on the number of delivery records returned in one request.
const MAX_DELIVERIES_LIMIT: usize = 1_000;

/// Shared application state injected into every handler.
#[derive(Clone)]
pub struct AppState {
    /// Subscriber registry.
    pub subscribers: SubscriberRegistry,
    /// Fan-out delivery engine.
    pub relay: Relay,
}

/// Build the application router with all routes wired to `state`.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route(
            "/subscribers",
            post(register_subscriber).get(list_subscribers),
        )
        .route("/subscribers/:id", delete(remove_subscriber))
        .route("/events", post(emit_event))
        .route("/deliveries", get(list_deliveries))
        .with_state(state)
}

/// Liveness probe.
async fn healthz() -> Json<Value> {
    Json(json!({ "data": { "status": "ok" } }))
}

/// Register a new subscriber endpoint.
async fn register_subscriber(
    State(state): State<AppState>,
    Json(input): Json<RegisterSubscriber>,
) -> Result<(StatusCode, Json<Value>)> {
    let url = input.url.trim();
    if url.is_empty() {
        return Err(RelayError::MissingField("url".into()));
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(RelayError::BadRequest(
            "url must be an absolute http(s) URL".into(),
        ));
    }

    let subscriber = state.subscribers.register(input);
    Ok((StatusCode::CREATED, Json(json!({ "data": subscriber }))))
}

/// List all registered subscribers.
async fn list_subscribers(State(state): State<AppState>) -> Json<Value> {
    let subscribers = state.subscribers.list();
    Json(json!({ "data": subscribers }))
}

/// Remove a subscriber by id.
async fn remove_subscriber(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    if state.subscribers.remove(&id) {
        Ok(Json(json!({ "data": { "id": id, "removed": true } })))
    } else {
        Err(RelayError::NotFound(id))
    }
}

/// Incoming event payload accepted by `POST /events`.
///
/// Matches the SettleKit webhook payload shape: `{id?, type, data, createdAt?}`.
/// `id` and `createdAt` are optional and synthesized when absent.
#[derive(Debug, Deserialize)]
struct EventInput {
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    data: Value,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
}

/// Accept an event, fan it out to matching subscribers, return delivery ids.
async fn emit_event(
    State(state): State<AppState>,
    Json(input): Json<EventInput>,
) -> Result<(StatusCode, Json<Value>)> {
    let event_type = input.event_type.trim().to_string();
    if event_type.is_empty() {
        return Err(RelayError::MissingField("type".into()));
    }

    // Build the canonical payload that will be signed and delivered. We
    // synthesize id/createdAt when the caller omitted them so every subscriber
    // receives a complete, well-formed SettleKit event envelope.
    let id = input
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("evt_{}", uuid::Uuid::new_v4()));
    let created_at = input.created_at.filter(|s| !s.trim().is_empty());

    let mut payload = json!({
        "id": id,
        "type": event_type,
        "data": input.data,
    });
    if let Some(created_at) = created_at {
        payload["createdAt"] = json!(created_at);
    } else {
        payload["createdAt"] = json!(unix_seconds());
    }

    let body = serde_json::to_vec(&payload)
        .map_err(|e| RelayError::Internal(format!("failed to serialize event: {e}")))?;
    let body = Arc::new(body);

    let matching = state.subscribers.matching(&event_type);
    let delivery_ids = state.relay.dispatch(&event_type, body, matching);
    let subscriber_count = delivery_ids.len();

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "data": {
                "eventId": id,
                "type": event_type,
                "deliveryIds": delivery_ids,
                "subscriberCount": subscriber_count,
            }
        })),
    ))
}

/// Query parameters for `GET /deliveries`.
#[derive(Debug, Deserialize)]
struct DeliveriesQuery {
    #[serde(default)]
    limit: Option<usize>,
}

/// Return the recent delivery log.
async fn list_deliveries(
    State(state): State<AppState>,
    Query(query): Query<DeliveriesQuery>,
) -> Json<Value> {
    let limit = query
        .limit
        .unwrap_or(DEFAULT_DELIVERIES_LIMIT)
        .clamp(1, MAX_DELIVERIES_LIMIT);
    let deliveries = state.relay.recent(limit);
    Json(json!({ "data": deliveries }))
}

/// Current unix time in seconds (best-effort; clock-skew tolerant).
fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}
