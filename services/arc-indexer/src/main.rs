//! SettleKit Arc indexer binary.
//!
//! Watches an Arc/EVM JSON-RPC endpoint for USDC ERC-20 `Transfer` events whose
//! recipient is a configured payout address, waits for a configurable number of
//! confirmations, then POSTs a payment confirmation to the SettleKit API.
//!
//! Flow per poll:
//!   1. `eth_blockNumber` for the chain head.
//!   2. The "safe head" = `head - confirmations` (only fully confirmed blocks).
//!   3. `eth_getLogs` for the USDC contract, Transfer topic0, and the watched
//!      `to` topic, over `(last_processed, safe_head]`.
//!   4. Decode each log and confirm the payment against the SettleKit API.
//!   5. Advance the in-memory `last_processed` cursor.
//!
//! Shutdown is graceful: Ctrl-C aborts the loop cleanly between/within polls.

mod config;
mod error;
mod rpc;
mod settlekit;
mod usdc;

use std::time::Duration;

use config::Config;
use error::{IndexerError, Result};
use rpc::RpcClient;
use settlekit::SettleKitClient;
use usdc::{address_to_topic, decode_transfer, Transfer, TRANSFER_TOPIC0};

/// Maximum block span requested in a single `eth_getLogs` call. Keeps individual
/// requests bounded when catching up from a far-behind cursor.
const MAX_BLOCK_SPAN: u64 = 2_000;

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("[arc-indexer] fatal: {err}");
        std::process::exit(1);
    }
}

/// Load config, build clients, and drive the poll loop until Ctrl-C.
async fn run() -> Result<()> {
    let config = Config::from_env()?;
    log_startup(&config);

    let rpc = RpcClient::new(config.rpc_url.clone());
    let api = SettleKitClient::new(config.api_url.clone(), config.api_key.clone());
    let to_topic = address_to_topic(&config.watch_address);

    // Establish the initial cursor: explicit START_BLOCK (process blocks at and
    // after it) or the current safe head (only process new transfers).
    let head = rpc.block_number().await?;
    let safe_head = head.saturating_sub(config.confirmations);
    let mut last_processed = match config.start_block {
        Some(start) => start.saturating_sub(1),
        None => safe_head,
    };
    println!(
        "[arc-indexer] starting cursor at block {last_processed} (chain head {head}, safe head {safe_head})"
    );

    let interval = Duration::from_secs(config.poll_interval_secs);

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("[arc-indexer] received Ctrl-C, shutting down gracefully");
                return Ok(());
            }
            outcome = poll_once(&rpc, &api, &config, &to_topic, last_processed) => {
                match outcome {
                    Ok(new_cursor) => last_processed = new_cursor,
                    Err(err) => eprintln!("[arc-indexer] poll error (will retry): {err}"),
                }
            }
        }

        // Sleep, but remain responsive to Ctrl-C during the wait.
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("[arc-indexer] received Ctrl-C, shutting down gracefully");
                return Ok(());
            }
            _ = tokio::time::sleep(interval) => {}
        }
    }
}

/// Run a single poll iteration; returns the advanced cursor on success.
async fn poll_once(
    rpc: &RpcClient,
    api: &SettleKitClient,
    config: &Config,
    to_topic: &str,
    last_processed: u64,
) -> Result<u64> {
    let head = rpc.block_number().await?;
    let safe_head = head.saturating_sub(config.confirmations);

    // Nothing new is fully confirmed yet.
    if safe_head <= last_processed {
        return Ok(last_processed);
    }

    let from_block = last_processed + 1;
    let to_block = std::cmp::min(safe_head, from_block + MAX_BLOCK_SPAN - 1);

    let logs = rpc
        .get_logs(
            &config.usdc_address,
            TRANSFER_TOPIC0,
            Some(to_topic),
            from_block,
            to_block,
        )
        .await?;

    if !logs.is_empty() {
        println!(
            "[arc-indexer] scanned blocks {from_block}..={to_block}: {} matching log(s)",
            logs.len()
        );
    }

    for log in &logs {
        match decode_transfer(log) {
            Ok(transfer) => {
                // Defense-in-depth: the RPC topic filter should guarantee this,
                // but verify the recipient before acting on the transfer.
                if !transfer.to.eq_ignore_ascii_case(&config.watch_address) {
                    continue;
                }
                handle_transfer(api, config, head, &transfer).await;
            }
            Err(err) => {
                eprintln!("[arc-indexer] skipping malformed log: {err}");
            }
        }
    }

    Ok(to_block)
}

/// Report a decoded transfer to the SettleKit observe endpoint, logging the
/// outcome. The API re-verifies the transfer on-chain and screens the sender;
/// failures are logged but do not abort the loop so a single bad report cannot
/// stall the indexer.
async fn handle_transfer(api: &SettleKitClient, config: &Config, head: u64, transfer: &Transfer) {
    let confirmations = head.saturating_sub(transfer.block_number) + 1;
    println!(
        "[arc-indexer] confirmed USDC transfer tx={} from={} amount={} confirmations={}",
        transfer.tx_hash, transfer.from, transfer.value, confirmations
    );

    match api
        .observe_payment(
            &config.organization_id,
            &transfer.tx_hash,
            &config.watch_address,
            &transfer.from,
            transfer.value,
            confirmations,
        )
        .await
    {
        Ok(()) => println!(
            "[arc-indexer] posted confirmation to SettleKit for tx={}",
            transfer.tx_hash
        ),
        Err(IndexerError::Api {
            status,
            code,
            message,
        }) => eprintln!(
            "[arc-indexer] SettleKit rejected tx={} (status {status}, {code}): {message}",
            transfer.tx_hash
        ),
        Err(err) => eprintln!(
            "[arc-indexer] failed to post confirmation for tx={}: {err}",
            transfer.tx_hash
        ),
    }
}

/// Emit a one-line startup summary (never logs the API key).
fn log_startup(config: &Config) {
    println!("[arc-indexer] SettleKit Arc indexer starting");
    println!("[arc-indexer]   rpc_url       = {}", config.rpc_url);
    println!("[arc-indexer]   usdc_address  = {}", config.usdc_address);
    println!("[arc-indexer]   watch_address = {}", config.watch_address);
    println!("[arc-indexer]   api_url       = {}", config.api_url);
    println!("[arc-indexer]   poll_interval = {}s", config.poll_interval_secs);
    println!("[arc-indexer]   confirmations = {}", config.confirmations);
    if let Some(start) = config.start_block {
        println!("[arc-indexer]   start_block   = {start}");
    }
}
