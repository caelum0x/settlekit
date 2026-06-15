//! Minimal JSON-RPC 2.0 client over `reqwest` for the EVM methods this indexer
//! needs: `eth_blockNumber` and `eth_getLogs`.
//!
//! The client is intentionally small and typed: each method serializes a
//! `JsonRpcRequest`, POSTs it, and deserializes a `JsonRpcResponse<T>`, mapping
//! any RPC-level `error` object to [`IndexerError::Rpc`].

use serde::{Deserialize, Serialize};

use crate::error::{IndexerError, Result};
use crate::usdc::parse_hex_u64;

/// A JSON-RPC 2.0 request envelope.
#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    params: serde_json::Value,
}

/// A JSON-RPC 2.0 response envelope, generic over the `result` payload.
#[derive(Debug, Deserialize)]
#[serde(bound = "T: for<'d> Deserialize<'d>")]
struct JsonRpcResponse<T> {
    #[serde(default = "none")]
    result: Option<T>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

/// Default for an optional `result` field that does not require `T: Default`.
fn none<T>() -> Option<T> {
    None
}

/// The `error` object of a JSON-RPC response.
#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

/// A single log entry as returned by `eth_getLogs`.
///
/// Only the fields this indexer consumes are modeled; unknown fields are
/// ignored by serde.
#[derive(Debug, Clone, Deserialize)]
pub struct Log {
    /// Event topics; `topics[0]` is the event signature hash.
    #[serde(default)]
    pub topics: Vec<String>,
    /// ABI-encoded non-indexed event data (`0x`-prefixed hex).
    #[serde(default)]
    pub data: String,
    /// Hash of the transaction that produced this log.
    #[serde(rename = "transactionHash")]
    pub transaction_hash: Option<String>,
    /// Block number containing this log, as a `0x`-prefixed hex quantity.
    #[serde(rename = "blockNumber")]
    pub block_number: Option<String>,
}

/// A filter for `eth_getLogs`. Block bounds are inclusive hex quantities.
#[derive(Debug, Serialize)]
struct LogFilter {
    #[serde(rename = "fromBlock")]
    from_block: String,
    #[serde(rename = "toBlock")]
    to_block: String,
    address: String,
    /// Topic filter: `[topic0, null|to-topic, ...]`.
    topics: Vec<Option<String>>,
}

/// Typed JSON-RPC client bound to a single endpoint.
#[derive(Debug, Clone)]
pub struct RpcClient {
    http: reqwest::Client,
    url: String,
}

impl RpcClient {
    /// Construct a client for the given JSON-RPC endpoint URL.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            url: url.into(),
        }
    }

    /// Perform a single JSON-RPC call and return the typed `result`.
    async fn call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T> {
        let body = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method,
            params,
        };

        let resp: JsonRpcResponse<T> = self
            .http
            .post(&self.url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        if let Some(err) = resp.error {
            return Err(IndexerError::Rpc {
                code: err.code,
                message: err.message,
            });
        }

        resp.result
            .ok_or_else(|| IndexerError::EmptyResult(method.to_string()))
    }

    /// `eth_blockNumber` — return the latest block height as a `u64`.
    pub async fn block_number(&self) -> Result<u64> {
        let hex: String = self.call("eth_blockNumber", serde_json::json!([])).await?;
        parse_hex_u64(&hex)
    }

    /// `eth_getLogs` for a contract + topic0 + optional `to` topic over a block
    /// range (inclusive). Block numbers are passed as hex quantities.
    pub async fn get_logs(
        &self,
        address: &str,
        topic0: &str,
        to_topic: Option<&str>,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Log>> {
        let filter = LogFilter {
            from_block: format!("0x{:x}", from_block),
            to_block: format!("0x{:x}", to_block),
            address: address.to_string(),
            topics: vec![Some(topic0.to_string()), None, to_topic.map(|t| t.to_string())],
        };
        self.call("eth_getLogs", serde_json::json!([filter])).await
    }
}
