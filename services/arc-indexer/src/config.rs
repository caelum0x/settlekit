//! Runtime configuration loaded entirely from the process environment.
//!
//! All values are validated at startup (fail-fast): addresses are normalized to
//! lower-case `0x`-prefixed 20-byte hex, numeric values are range-checked, and
//! required fields must be present and non-empty. The struct is immutable once
//! built — callers receive a fully validated [`Config`] or a descriptive error.

use crate::error::{IndexerError, Result};

/// Default seconds between RPC polls when `POLL_INTERVAL_SECS` is unset.
const DEFAULT_POLL_INTERVAL_SECS: u64 = 12;
/// Default number of confirmations required before a transfer is reported.
const DEFAULT_CONFIRMATIONS: u64 = 3;

/// Fully validated, immutable indexer configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// JSON-RPC HTTP endpoint of the Arc/EVM node.
    pub rpc_url: String,
    /// USDC ERC-20 contract address, normalized `0x` + 40 lower-case hex chars.
    pub usdc_address: String,
    /// Watched payout address (the `to` of relevant Transfer events).
    pub watch_address: String,
    /// Base URL of the SettleKit API (no trailing slash).
    pub api_url: String,
    /// Bearer API key used to authenticate confirmation requests.
    pub api_key: String,
    /// Seconds to sleep between polls.
    pub poll_interval_secs: u64,
    /// Confirmations required before a transfer is posted to the API.
    pub confirmations: u64,
    /// Optional starting block; when `None` the indexer starts at the chain head.
    pub start_block: Option<u64>,
}

impl Config {
    /// Build a [`Config`] from environment variables, validating every field.
    pub fn from_env() -> Result<Self> {
        let rpc_url = required("ARC_RPC_URL")?;
        let usdc_address = normalize_address("ARC_USDC_ADDRESS", &required("ARC_USDC_ADDRESS")?)?;
        let watch_address = normalize_address("WATCH_ADDRESS", &required("WATCH_ADDRESS")?)?;
        let api_url = required("SETTLEKIT_API_URL")?
            .trim_end_matches('/')
            .to_string();
        let api_key = required("SETTLEKIT_API_KEY")?;

        let poll_interval_secs =
            parse_u64_or("POLL_INTERVAL_SECS", DEFAULT_POLL_INTERVAL_SECS)?;
        if poll_interval_secs == 0 {
            return Err(IndexerError::InvalidEnv {
                name: "POLL_INTERVAL_SECS".into(),
                reason: "must be greater than zero".into(),
            });
        }

        let confirmations = parse_u64_or("CONFIRMATIONS", DEFAULT_CONFIRMATIONS)?;

        let start_block = match std::env::var("START_BLOCK") {
            Ok(v) if !v.trim().is_empty() => Some(parse_u64("START_BLOCK", v.trim())?),
            _ => None,
        };

        Ok(Self {
            rpc_url,
            usdc_address,
            watch_address,
            api_url,
            api_key,
            poll_interval_secs,
            confirmations,
            start_block,
        })
    }
}

/// Read a required, non-empty environment variable.
fn required(name: &str) -> Result<String> {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => Ok(v.trim().to_string()),
        _ => Err(IndexerError::MissingEnv(name.to_string())),
    }
}

/// Parse an optional `u64` env var, falling back to `default` when unset/empty.
fn parse_u64_or(name: &str, default: u64) -> Result<u64> {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => parse_u64(name, v.trim()),
        _ => Ok(default),
    }
}

/// Parse a base-10 `u64`, attributing parse failures to a named env var.
fn parse_u64(name: &str, value: &str) -> Result<u64> {
    value.parse::<u64>().map_err(|e| IndexerError::InvalidEnv {
        name: name.to_string(),
        reason: e.to_string(),
    })
}

/// Validate and normalize a 20-byte EVM address to `0x` + 40 lower-case hex.
fn normalize_address(name: &str, raw: &str) -> Result<String> {
    let body = raw.strip_prefix("0x").or_else(|| raw.strip_prefix("0X")).unwrap_or(raw);
    if body.len() != 40 {
        return Err(IndexerError::InvalidEnv {
            name: name.to_string(),
            reason: format!("expected a 20-byte (40 hex char) address, got {} chars", body.len()),
        });
    }
    if !body.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(IndexerError::InvalidEnv {
            name: name.to_string(),
            reason: "address contains non-hex characters".into(),
        });
    }
    Ok(format!("0x{}", body.to_ascii_lowercase()))
}
