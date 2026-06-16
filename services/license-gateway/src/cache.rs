//! A small lock-free TTL cache backed by [`dashmap::DashMap`].
//!
//! Entries store a value alongside an [`Instant`] expiry. Reads are O(1) and
//! never block writers thanks to DashMap's sharded locking. A lightweight sweep
//! removes expired entries opportunistically so the map does not grow unbounded
//! for keys that are never read again.

use std::time::{Duration, Instant};

use dashmap::DashMap;

/// An individual cache entry: the cached value plus the moment it expires.
#[derive(Debug, Clone)]
struct Entry<V> {
    value: V,
    expires_at: Instant,
}

impl<V> Entry<V> {
    /// Whether this entry is still valid at `now`.
    #[inline]
    fn is_fresh(&self, now: Instant) -> bool {
        now < self.expires_at
    }
}

/// A thread-safe TTL cache keyed by `String`.
///
/// Cloning is cheap: the underlying map is shared, so clones observe the same
/// data. This makes it convenient to store inside axum application state.
#[derive(Debug, Clone)]
pub struct TtlCache<V> {
    inner: std::sync::Arc<DashMap<String, Entry<V>>>,
    ttl: Duration,
}

impl<V> TtlCache<V>
where
    V: Clone,
{
    /// Create a new cache where inserted entries live for `ttl`.
    pub fn new(ttl: Duration) -> Self {
        Self {
            inner: std::sync::Arc::new(DashMap::new()),
            ttl,
        }
    }

    /// Fetch a value if present and not expired.
    ///
    /// Expired entries are removed lazily on access, so a stale hit returns
    /// `None` and frees its slot.
    pub fn get(&self, key: &str) -> Option<V> {
        let now = Instant::now();
        if let Some(entry) = self.inner.get(key) {
            if entry.is_fresh(now) {
                return Some(entry.value.clone());
            }
        }
        // Either absent or stale: drop the stale slot and report a miss.
        self.inner.remove(key);
        None
    }

    /// Insert (or overwrite) a value, expiring after the configured TTL.
    ///
    /// Performs a bounded opportunistic sweep of expired entries to keep memory
    /// usage proportional to the live working set.
    pub fn insert(&self, key: String, value: V) {
        let now = Instant::now();
        let entry = Entry {
            value,
            expires_at: now + self.ttl,
        };
        self.inner.insert(key, entry);
        self.sweep(now);
    }

    /// Number of entries currently stored (including any not yet swept).
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Whether the cache currently holds no entries.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Remove expired entries. Bounded so a single call stays cheap even when
    /// the map is large; remaining stale entries are reclaimed on later reads.
    fn sweep(&self, now: Instant) {
        const MAX_SWEEP: usize = 64;
        let mut expired: Vec<String> = Vec::new();
        for item in self.inner.iter() {
            if !item.value().is_fresh(now) {
                expired.push(item.key().clone());
                if expired.len() >= MAX_SWEEP {
                    break;
                }
            }
        }
        for key in expired {
            self.inner.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_then_expiry() {
        let cache: TtlCache<u32> = TtlCache::new(Duration::from_millis(20));
        cache.insert("k".to_string(), 7);
        assert_eq!(cache.get("k"), Some(7));
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(cache.get("k"), None);
        assert!(cache.is_empty());
    }

    #[test]
    fn overwrite_refreshes_value() {
        let cache: TtlCache<&str> = TtlCache::new(Duration::from_secs(60));
        cache.insert("k".to_string(), "a");
        cache.insert("k".to_string(), "b");
        assert_eq!(cache.get("k"), Some("b"));
        assert_eq!(cache.len(), 1);
    }
}
