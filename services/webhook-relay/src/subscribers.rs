//! In-memory subscriber registry.
//!
//! Subscribers are webhook endpoints that wish to receive fanned-out events. The
//! registry is a [`DashMap`] keyed by subscriber id, supporting concurrent
//! register/list/remove from many request handlers and background delivery tasks.

use std::sync::Arc;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A registered subscriber endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscriber {
    /// Server-assigned unique identifier.
    pub id: String,
    /// Absolute URL that signed event bodies are POSTed to.
    pub url: String,
    /// Event type filter. Empty means "receive all event types".
    pub event_types: Vec<String>,
    /// When false, the subscriber is skipped during fan-out.
    pub active: bool,
}

impl Subscriber {
    /// Does this subscriber want to receive an event of `event_type`?
    ///
    /// An empty `event_types` filter matches every event.
    pub fn matches(&self, event_type: &str) -> bool {
        self.active
            && (self.event_types.is_empty() || self.event_types.iter().any(|t| t == event_type))
    }
}

/// Input used to register a new subscriber.
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterSubscriber {
    /// Absolute URL that signed event bodies are POSTed to.
    pub url: String,
    /// Optional event type filter; absent or empty means "all events".
    #[serde(default)]
    pub event_types: Vec<String>,
    /// Optional active flag; defaults to `true` when omitted.
    #[serde(default = "default_active")]
    pub active: bool,
}

fn default_active() -> bool {
    true
}

/// Concurrent registry of subscribers keyed by id.
#[derive(Clone, Default)]
pub struct SubscriberRegistry {
    inner: Arc<DashMap<String, Subscriber>>,
}

impl SubscriberRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
        }
    }

    /// Register a new subscriber, returning the stored record (with its id).
    pub fn register(&self, input: RegisterSubscriber) -> Subscriber {
        let subscriber = Subscriber {
            id: Uuid::new_v4().to_string(),
            url: input.url,
            event_types: input.event_types,
            active: input.active,
        };
        self.inner.insert(subscriber.id.clone(), subscriber.clone());
        subscriber
    }

    /// List all subscribers (cloned snapshot).
    pub fn list(&self) -> Vec<Subscriber> {
        self.inner.iter().map(|e| e.value().clone()).collect()
    }

    /// Remove a subscriber by id, returning `true` if one was removed.
    pub fn remove(&self, id: &str) -> bool {
        self.inner.remove(id).is_some()
    }

    /// All active subscribers whose filter matches `event_type`.
    pub fn matching(&self, event_type: &str) -> Vec<Subscriber> {
        self.inner
            .iter()
            .filter(|e| e.value().matches(event_type))
            .map(|e| e.value().clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg(url: &str, types: &[&str], active: bool) -> RegisterSubscriber {
        RegisterSubscriber {
            url: url.to_string(),
            event_types: types.iter().map(|s| s.to_string()).collect(),
            active,
        }
    }

    #[test]
    fn register_assigns_id_and_lists() {
        let registry = SubscriberRegistry::new();
        let s = registry.register(reg("https://a.example/hook", &["payment.created"], true));
        assert!(!s.id.is_empty());
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn remove_returns_false_for_unknown_id() {
        let registry = SubscriberRegistry::new();
        assert!(!registry.remove("does-not-exist"));
    }

    #[test]
    fn empty_filter_matches_all_events() {
        let registry = SubscriberRegistry::new();
        registry.register(reg("https://a.example/hook", &[], true));
        assert_eq!(registry.matching("anything.happened").len(), 1);
    }

    #[test]
    fn filter_excludes_non_matching_types() {
        let registry = SubscriberRegistry::new();
        registry.register(reg("https://a.example/hook", &["payment.created"], true));
        assert_eq!(registry.matching("payment.created").len(), 1);
        assert_eq!(registry.matching("refund.created").len(), 0);
    }

    #[test]
    fn inactive_subscribers_never_match() {
        let registry = SubscriberRegistry::new();
        registry.register(reg("https://a.example/hook", &[], false));
        assert_eq!(registry.matching("payment.created").len(), 0);
    }
}
