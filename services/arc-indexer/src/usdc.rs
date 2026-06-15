//! USDC / ERC-20 `Transfer` event constants and decoding.
//!
//! The ERC-20 `Transfer(address,address,uint256)` event has the signature hash
//! (topic0) `keccak256("Transfer(address,address,uint256)")`. This is a fixed,
//! well-known value across every ERC-20 token, so we embed the literal rather
//! than pulling in a keccak dependency.
//!
//! Event layout for an indexed-from / indexed-to transfer:
//!   - `topics[0]` = event signature hash (see [`TRANSFER_TOPIC0`])
//!   - `topics[1]` = `from` address, left-padded to 32 bytes
//!   - `topics[2]` = `to` address, left-padded to 32 bytes
//!   - `data`      = the `uint256` value (32 bytes, big-endian)

use crate::error::{IndexerError, Result};
use crate::rpc::Log;

/// `keccak256("Transfer(address,address,uint256)")` — the ERC-20 Transfer topic0.
pub const TRANSFER_TOPIC0: &str =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/// A decoded ERC-20 Transfer event.
#[derive(Debug, Clone)]
pub struct Transfer {
    /// Sender address, normalized `0x` + 40 lower-case hex.
    pub from: String,
    /// Recipient address, normalized `0x` + 40 lower-case hex.
    pub to: String,
    /// Transferred amount in the token's base units (USDC has 6 decimals).
    pub value: u128,
    /// Transaction hash that emitted the event, `0x`-prefixed.
    pub tx_hash: String,
    /// Block number (decoded from the log's hex `blockNumber`) the event is in.
    pub block_number: u64,
}

/// Left-pad a 20-byte address into a 32-byte topic: `0x` + 24 zero-nibbles + addr.
///
/// Used to build the `to` topic filter passed to `eth_getLogs`.
pub fn address_to_topic(address: &str) -> String {
    let body = address
        .strip_prefix("0x")
        .or_else(|| address.strip_prefix("0X"))
        .unwrap_or(address)
        .to_ascii_lowercase();
    format!("0x{:0>64}", body)
}

/// Extract a 20-byte address from a 32-byte (64 hex char) topic word.
fn topic_to_address(topic: &str) -> Result<String> {
    let body = topic
        .strip_prefix("0x")
        .or_else(|| topic.strip_prefix("0X"))
        .unwrap_or(topic);
    if body.len() != 64 {
        return Err(IndexerError::MalformedLog(format!(
            "address topic must be 32 bytes (64 hex chars), got {}",
            body.len()
        )));
    }
    // The address is the rightmost 20 bytes (last 40 hex chars).
    let addr = &body[24..];
    if !addr.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(IndexerError::MalformedLog(
            "address topic contains non-hex characters".into(),
        ));
    }
    Ok(format!("0x{}", addr.to_ascii_lowercase()))
}

/// Decode a `uint256` (big-endian) from a `0x`-prefixed hex data field into a
/// `u128`. USDC's max supply fits comfortably in `u128`; a value exceeding the
/// `u128` range is reported as a malformed log rather than silently truncated.
fn decode_uint256(data: &str) -> Result<u128> {
    let body = data
        .strip_prefix("0x")
        .or_else(|| data.strip_prefix("0X"))
        .unwrap_or(data);
    let body = body.trim();
    if body.is_empty() {
        return Ok(0);
    }
    let bytes = hex::decode(if body.len() % 2 == 1 {
        format!("0{}", body)
    } else {
        body.to_string()
    })?;

    // Reject anything that cannot fit into 16 bytes (u128) once leading zeros
    // are stripped.
    let significant: &[u8] = {
        let first = bytes.iter().position(|&b| b != 0).unwrap_or(bytes.len());
        &bytes[first..]
    };
    if significant.len() > 16 {
        return Err(IndexerError::MalformedLog(format!(
            "transfer value exceeds u128 range ({} significant bytes)",
            significant.len()
        )));
    }

    let mut value: u128 = 0;
    for &b in significant {
        value = (value << 8) | b as u128;
    }
    Ok(value)
}

/// Parse a hex quantity such as a block number (`0x...`) into `u64`.
pub fn parse_hex_u64(value: &str) -> Result<u64> {
    let body = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);
    u64::from_str_radix(body, 16).map_err(|e| IndexerError::InvalidQuantity {
        value: value.to_string(),
        reason: e.to_string(),
    })
}

/// Decode a raw `eth_getLogs` [`Log`] into a typed [`Transfer`].
///
/// Validates that the log is a genuine ERC-20 `Transfer` (correct topic0 and
/// three topics) before extracting the addresses and value.
pub fn decode_transfer(log: &Log) -> Result<Transfer> {
    if log.topics.len() < 3 {
        return Err(IndexerError::MalformedLog(format!(
            "expected 3 topics for an indexed Transfer, got {}",
            log.topics.len()
        )));
    }
    if !log.topics[0].eq_ignore_ascii_case(TRANSFER_TOPIC0) {
        return Err(IndexerError::MalformedLog(format!(
            "topic0 is not the Transfer signature: {}",
            log.topics[0]
        )));
    }

    let from = topic_to_address(&log.topics[1])?;
    let to = topic_to_address(&log.topics[2])?;
    let value = decode_uint256(&log.data)?;

    let tx_hash = log
        .transaction_hash
        .clone()
        .ok_or_else(|| IndexerError::MalformedLog("log missing transactionHash".into()))?;

    let block_number = match &log.block_number {
        Some(bn) => parse_hex_u64(bn)?,
        None => {
            return Err(IndexerError::MalformedLog(
                "log missing blockNumber".into(),
            ))
        }
    };

    Ok(Transfer {
        from,
        to,
        value,
        tx_hash,
        block_number,
    })
}
