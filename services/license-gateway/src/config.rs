//! Typed configuration loaded from the process environment.
//!
//! All values have sensible defaults except the SettleKit API key, which is
//! required. Validation happens once at startup so the rest of the service can
//! assume a well-formed [`Config`].

use std::env;
use std::time::Duration;

use thiserror::Error;

/// Default upstream SettleKit API base URL.
const DEFAULT_API_URL: &str = "http://localhost:8787";
/// Default port the gateway listens on.
const DEFAULT_PORT: u16 = 8090;
/// Default cache time-to-live in seconds.
const DEFAULT_CACHE_TTL_SECS: u64 = 30;
/// Default HTTP request timeout for upstream calls, in seconds.
const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 10;

/// Errors that can occur while loading configuration from the environment.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// A required environment variable was missing or empty.
    #[error("missing required environment variable: {0}")]
    Missing(&'static str),

    /// An environment variable held a value that could not be parsed.
    #[error("invalid value for {var}: {message}")]
    Invalid {
        /// The offending environment variable name.
        var: &'static str,
        /// A human-readable explanation of the failure.
        message: String,
    },
}

/// Fully validated runtime configuration for the gateway.
#[derive(Debug, Clone)]
pub struct Config {
    /// Base URL of the upstream SettleKit API (no trailing slash).
    pub api_url: String,
    /// Bearer API key used to authenticate against the SettleKit API.
    pub api_key: String,
    /// TCP port the gateway binds to.
    pub port: u16,
    /// How long a cached verification result remains valid.
    pub cache_ttl: Duration,
    /// Timeout applied to each upstream HTTP request.
    pub request_timeout: Duration,
}

impl Config {
    /// Load and validate configuration from the process environment.
    ///
    /// Reads `SETTLEKIT_API_URL`, `SETTLEKIT_API_KEY`, `PORT`,
    /// `CACHE_TTL_SECS`, and `REQUEST_TIMEOUT_SECS`.
    pub fn from_env() -> Result<Self, ConfigError> {
        let api_url = env::var("SETTLEKIT_API_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_API_URL.to_string());
        // Normalize by stripping any trailing slash so URL joins are predictable.
        let api_url = api_url.trim_end_matches('/').to_string();

        let api_key = env::var("SETTLEKIT_API_KEY")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .ok_or(ConfigError::Missing("SETTLEKIT_API_KEY"))?;

        let port = parse_env("PORT", DEFAULT_PORT)?;
        if port == 0 {
            return Err(ConfigError::Invalid {
                var: "PORT",
                message: "port must be between 1 and 65535".to_string(),
            });
        }

        let ttl_secs = parse_env("CACHE_TTL_SECS", DEFAULT_CACHE_TTL_SECS)?;
        let timeout_secs = parse_env("REQUEST_TIMEOUT_SECS", DEFAULT_REQUEST_TIMEOUT_SECS)?;
        if timeout_secs == 0 {
            return Err(ConfigError::Invalid {
                var: "REQUEST_TIMEOUT_SECS",
                message: "timeout must be greater than zero".to_string(),
            });
        }

        Ok(Self {
            api_url,
            api_key,
            port,
            cache_ttl: Duration::from_secs(ttl_secs),
            request_timeout: Duration::from_secs(timeout_secs),
        })
    }
}

/// Parse an environment variable into `T`, falling back to `default` when unset
/// or empty. Returns [`ConfigError::Invalid`] when present but unparseable.
fn parse_env<T>(var: &'static str, default: T) -> Result<T, ConfigError>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env::var(var) {
        Ok(raw) if !raw.trim().is_empty() => raw.trim().parse::<T>().map_err(|e| ConfigError::Invalid {
            var,
            message: e.to_string(),
        }),
        _ => Ok(default),
    }
}
