//! HMAC-SHA256 request signing.
//!
//! Produces the canonical SettleKit webhook signature scheme (Stripe-style):
//! the `SettleKit-Signature` header carries `t=<unix-seconds>,v1=<hex>` where
//! `<hex>` is the lower-case HMAC-SHA256 of `"<t>.<raw body>"` keyed by the
//! shared signing secret. Subscribers verify by recomputing the HMAC over
//! `"<t>.<received body>"` and comparing in constant time — this matches the
//! `verify_signature` helpers shipped in every SettleKit SDK (TS, Python, Go,
//! Rust), so deliveries from the relay are accepted without special-casing.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Header name carrying the signature on outbound deliveries.
pub const SIGNATURE_HEADER: &str = "SettleKit-Signature";

/// An HMAC-SHA256 signer holding the shared secret.
#[derive(Clone)]
pub struct Signer {
    secret: Vec<u8>,
}

impl Signer {
    /// Construct a signer from a secret string.
    pub fn new(secret: impl AsRef<[u8]>) -> Self {
        Self {
            secret: secret.as_ref().to_vec(),
        }
    }

    /// Compute the `t=<timestamp>,v1=<hex>` signature header value for `body`
    /// signed at `timestamp` (unix seconds). The HMAC input is `"<t>.<body>"`.
    ///
    /// HMAC accepts a key of any length, so construction never fails.
    pub fn sign(&self, body: &[u8], timestamp: i64) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.secret)
            .expect("HMAC-SHA256 accepts keys of any length");
        mac.update(timestamp.to_string().as_bytes());
        mac.update(b".");
        mac.update(body);
        let digest = mac.finalize().into_bytes();
        format!("t={timestamp},v1={}", hex::encode(digest))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_timestamped_v1_signature() {
        let signer = Signer::new("test-secret");
        let sig = signer.sign(br#"{"hello":"world"}"#, 1_781_610_000);
        assert!(sig.starts_with("t=1781610000,v1="));
        let hex_part = sig.rsplit("v1=").next().unwrap();
        // SHA256 -> 32 bytes -> 64 hex chars.
        assert_eq!(hex_part.len(), 64);
        assert!(hex_part.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn signature_is_deterministic_for_same_input() {
        let signer = Signer::new("secret");
        let a = signer.sign(b"payload", 1000);
        let b = signer.sign(b"payload", 1000);
        assert_eq!(a, b);
    }

    #[test]
    fn timestamp_is_bound_into_the_signature() {
        let signer = Signer::new("secret");
        assert_ne!(signer.sign(b"payload", 1000), signer.sign(b"payload", 1001));
    }

    #[test]
    fn different_bodies_produce_different_signatures() {
        let signer = Signer::new("secret");
        assert_ne!(signer.sign(b"a", 1000), signer.sign(b"b", 1000));
    }

    #[test]
    fn matches_known_hmac_sha256_vector() {
        // HMAC-SHA256(key="key", msg="1000.payload"), lower-case hex.
        let signer = Signer::new("key");
        let sig = signer.sign(b"payload", 1000);
        let hex_part = sig.rsplit("v1=").next().unwrap();
        assert_eq!(
            hex_part,
            "bba1f58f7f7a8b6891bf1b09908750d5f01e7c2ec2bce4a87ae0e8acdbc231a8"
        );
    }
}
