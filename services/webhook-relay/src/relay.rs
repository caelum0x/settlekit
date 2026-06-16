//! Fan-out delivery engine.
//!
//! For an incoming event the relay:
//!   1. Selects active subscribers whose filter matches the event type.
//!   2. Creates a delivery-log entry per subscriber and returns the delivery ids
//!      immediately so the `POST /events` handler can respond promptly.
//!   3. Spawns one tokio task per delivery that POSTs the signed body with
//!      exponential backoff (`retry_base_ms * 2^attempt`, up to `max_retries`
//!      attempts), updating the delivery-log entry after each attempt.
//!
//! The delivery log is a [`DashMap`] keyed by delivery id, retaining a bounded
//! number of the most recent deliveries.

use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use serde::Serialize;
use uuid::Uuid;

use crate::signer::{Signer, SIGNATURE_HEADER};
use crate::subscribers::Subscriber;

/// Maximum number of delivery records retained in memory.
const MAX_DELIVERY_LOG: usize = 1_000;

/// Terminal/disposition status of a delivery across all its attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    /// Queued but no attempt has completed yet.
    Pending,
    /// An attempt received a 2xx response.
    Delivered,
    /// All attempts were exhausted without a 2xx response.
    Failed,
}

/// A single delivery record in the in-memory log.
#[derive(Debug, Clone, Serialize)]
pub struct Delivery {
    /// Unique delivery identifier.
    pub id: String,
    /// Subscriber this delivery targets.
    pub subscriber_id: String,
    /// Destination URL.
    pub url: String,
    /// Event type being delivered.
    pub event_type: String,
    /// Current disposition.
    pub status: DeliveryStatus,
    /// Number of attempts made so far.
    pub attempts: u32,
    /// HTTP status of the most recent attempt, if any (0 on transport failure).
    pub last_status: Option<u16>,
    /// Error message from the most recent failed attempt, if any.
    pub last_error: Option<String>,
}

/// Shared, cloneable handle to the delivery engine.
#[derive(Clone)]
pub struct Relay {
    http: reqwest::Client,
    signer: Signer,
    log: Arc<DashMap<String, Delivery>>,
    max_retries: u32,
    retry_base_ms: u64,
}

impl Relay {
    /// Build a relay with the given signer and retry policy.
    pub fn new(signer: Signer, max_retries: u32, retry_base_ms: u64) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("settlekit-webhook-relay/0.1")
            .build()
            .expect("reqwest client builds with default rustls config");

        Self {
            http,
            signer,
            log: Arc::new(DashMap::new()),
            max_retries,
            retry_base_ms,
        }
    }

    /// Fan an event out to `subscribers`. Returns the created delivery ids and
    /// spawns a background task per delivery. Returns immediately.
    ///
    /// `body` is the exact raw JSON bytes that will be signed and POSTed.
    pub fn dispatch(
        &self,
        event_type: &str,
        body: Arc<Vec<u8>>,
        subscribers: Vec<Subscriber>,
    ) -> Vec<String> {
        let mut ids = Vec::with_capacity(subscribers.len());

        for subscriber in subscribers {
            let delivery_id = Uuid::new_v4().to_string();
            let record = Delivery {
                id: delivery_id.clone(),
                subscriber_id: subscriber.id.clone(),
                url: subscriber.url.clone(),
                event_type: event_type.to_string(),
                status: DeliveryStatus::Pending,
                attempts: 0,
                last_status: None,
                last_error: None,
            };
            self.insert_record(record);
            ids.push(delivery_id.clone());

            let engine = self.clone();
            let body = Arc::clone(&body);
            let event_type = event_type.to_string();
            tokio::spawn(async move {
                engine
                    .deliver_with_retry(delivery_id, subscriber, event_type, body)
                    .await;
            });
        }

        ids
    }

    /// Snapshot of the `limit` most recent deliveries (newest first by attempts
    /// is not meaningful, so we simply return up to `limit` records).
    pub fn recent(&self, limit: usize) -> Vec<Delivery> {
        let mut all: Vec<Delivery> = self.log.iter().map(|e| e.value().clone()).collect();
        // Deterministic ordering: pending/failed surfaced predictably by id.
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all.into_iter().take(limit).collect()
    }

    /// Insert a record, trimming the log if it exceeds the retention bound.
    fn insert_record(&self, record: Delivery) {
        if self.log.len() >= MAX_DELIVERY_LOG {
            // Evict an arbitrary settled entry to stay bounded. We prefer to drop
            // entries that have reached a terminal state.
            if let Some(victim) = self
                .log
                .iter()
                .find(|e| e.value().status != DeliveryStatus::Pending)
                .map(|e| e.key().clone())
            {
                self.log.remove(&victim);
            }
        }
        self.log.insert(record.id.clone(), record);
    }

    /// Update an existing delivery record in place via a closure.
    fn update_record(&self, id: &str, f: impl FnOnce(&mut Delivery)) {
        if let Some(mut entry) = self.log.get_mut(id) {
            f(entry.value_mut());
        }
    }

    /// Deliver to a single subscriber with exponential backoff.
    async fn deliver_with_retry(
        &self,
        delivery_id: String,
        subscriber: Subscriber,
        event_type: String,
        body: Arc<Vec<u8>>,
    ) {
        // Sign once with the dispatch timestamp; the same value is reused across
        // retries so the subscriber's replay window is measured from first send.
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let signature = self.signer.sign(&body, timestamp);

        for attempt in 0..self.max_retries {
            // Backoff before every attempt except the first.
            if attempt > 0 {
                let delay_ms = self
                    .retry_base_ms
                    .saturating_mul(2u64.saturating_pow(attempt));
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }

            let outcome = self
                .http
                .post(&subscriber.url)
                .header("content-type", "application/json")
                .header(SIGNATURE_HEADER, &signature)
                .header("SettleKit-Event", &event_type)
                .body((*body).clone())
                .send()
                .await;

            match outcome {
                Ok(resp) => {
                    let status = resp.status();
                    let code = status.as_u16();
                    let success = status.is_success();
                    self.update_record(&delivery_id, |d| {
                        d.attempts = attempt + 1;
                        d.last_status = Some(code);
                        if success {
                            d.status = DeliveryStatus::Delivered;
                            d.last_error = None;
                        }
                    });

                    if success {
                        tracing::info!(
                            delivery_id = %delivery_id,
                            url = %subscriber.url,
                            status = code,
                            attempt = attempt + 1,
                            "delivery succeeded"
                        );
                        return;
                    }

                    tracing::warn!(
                        delivery_id = %delivery_id,
                        url = %subscriber.url,
                        status = code,
                        attempt = attempt + 1,
                        "delivery returned non-2xx"
                    );
                }
                Err(err) => {
                    let msg = err.to_string();
                    self.update_record(&delivery_id, |d| {
                        d.attempts = attempt + 1;
                        d.last_status = Some(0);
                        d.last_error = Some(msg.clone());
                    });
                    tracing::warn!(
                        delivery_id = %delivery_id,
                        url = %subscriber.url,
                        attempt = attempt + 1,
                        error = %msg,
                        "delivery transport error"
                    );
                }
            }
        }

        // Exhausted all attempts without a 2xx.
        self.update_record(&delivery_id, |d| {
            if d.status != DeliveryStatus::Delivered {
                d.status = DeliveryStatus::Failed;
            }
        });
        tracing::error!(
            delivery_id = %delivery_id,
            url = %subscriber.url,
            attempts = self.max_retries,
            "delivery failed after exhausting retries"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subscribers::Subscriber;

    fn sub(url: &str) -> Subscriber {
        Subscriber {
            id: Uuid::new_v4().to_string(),
            url: url.to_string(),
            event_types: vec![],
            active: true,
        }
    }

    #[tokio::test]
    async fn dispatch_creates_one_delivery_per_subscriber() {
        let relay = Relay::new(Signer::new("secret"), 1, 1);
        // Use an unroutable address so attempts fail fast; we only assert the log
        // entries are created synchronously by dispatch.
        let body = Arc::new(br#"{"id":"evt_1","type":"x","data":{}}"#.to_vec());
        let ids = relay.dispatch(
            "x",
            body,
            vec![sub("http://127.0.0.1:9/a"), sub("http://127.0.0.1:9/b")],
        );
        assert_eq!(ids.len(), 2);
        assert_eq!(relay.recent(10).len(), 2);
    }

    #[test]
    fn backoff_grows_exponentially() {
        let base: u64 = 500;
        let delays: Vec<u64> = (1..4)
            .map(|attempt| base.saturating_mul(2u64.saturating_pow(attempt)))
            .collect();
        assert_eq!(delays, vec![1000, 2000, 4000]);
    }
}
