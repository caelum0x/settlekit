//! Runtime configuration loaded entirely from the process environment.
//!
//! All values are validated at startup (fail-fast). The struct is immutable once
//! built — callers receive a fully validated [`Config`] or a descriptive error.

use anyhow::{anyhow, Context, Result};

/// Default TCP port when `PORT` is unset.
const DEFAULT_PORT: u16 = 8091;
/// Default maximum delivery attempts when `MAX_RETRIES` is unset.
const DEFAULT_MAX_RETRIES: u32 = 5;
/// Default backoff base (milliseconds) when `RETRY_BASE_MS` is unset.
const DEFAULT_RETRY_BASE_MS: u64 = 500;

/// Fully validated, immutable relay configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// TCP port the HTTP server binds to.
    pub port: u16,
    /// HMAC-SHA256 signing secret applied to every outbound delivery body.
    pub signing_secret: String,
    /// Maximum number of delivery attempts per subscriber before giving up.
    pub max_retries: u32,
    /// Base delay (milliseconds) for the exponential backoff schedule.
    pub retry_base_ms: u64,
}

impl Config {
    /// Build a [`Config`] from environment variables, validating every field.
    pub fn from_env() -> Result<Self> {
        let port = parse_or("PORT", DEFAULT_PORT)?;

        let signing_secret = required("SIGNING_SECRET")?;
        if signing_secret.len() < 8 {
            return Err(anyhow!(
                "SIGNING_SECRET must be at least 8 characters for meaningful HMAC security"
            ));
        }

        let max_retries = parse_or("MAX_RETRIES", DEFAULT_MAX_RETRIES)?;
        if max_retries == 0 {
            return Err(anyhow!("MAX_RETRIES must be greater than zero"));
        }

        let retry_base_ms = parse_or("RETRY_BASE_MS", DEFAULT_RETRY_BASE_MS)?;
        if retry_base_ms == 0 {
            return Err(anyhow!("RETRY_BASE_MS must be greater than zero"));
        }

        Ok(Self {
            port,
            signing_secret,
            max_retries,
            retry_base_ms,
        })
    }
}

/// Read a required, non-empty environment variable (trimmed).
fn required(name: &str) -> Result<String> {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => Ok(v.trim().to_string()),
        _ => Err(anyhow!("missing required environment variable: {name}")),
    }
}

/// Parse an optional env var of any `FromStr` type, falling back to `default`.
fn parse_or<T>(name: &str, default: T) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => v
            .trim()
            .parse::<T>()
            .map_err(|e| anyhow!("{e}"))
            .with_context(|| format!("invalid value for environment variable {name}")),
        _ => Ok(default),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_or_falls_back_when_unset() {
        // A name that is overwhelmingly unlikely to be set in the test env.
        let v: u16 = parse_or("WEBHOOK_RELAY_TEST_UNSET_VAR_X", 4242).unwrap();
        assert_eq!(v, 4242);
    }
}
