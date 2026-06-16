//! SettleKit webhook relay microservice.
//!
//! Receives SettleKit webhook events on `POST /events` and fans them out to any
//! number of registered subscriber URLs, HMAC-signing each delivery body with the
//! SettleKit `v1=<hex>` scheme and retrying with exponential backoff. Every
//! delivery attempt is recorded in an in-memory delivery log queryable at
//! `GET /deliveries`.
//!
//! Configuration is loaded from the environment (see [`config::Config`]). The
//! `POST /events` handler returns promptly: actual HTTP delivery runs on spawned
//! tokio tasks.

mod config;
mod error;
mod relay;
mod routes;
mod signer;
mod subscribers;

use std::net::SocketAddr;

use anyhow::Context;

use config::Config;
use relay::Relay;
use routes::{router, AppState};
use signer::Signer;
use subscribers::SubscriberRegistry;

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("[webhook-relay] fatal: {err:#}");
        std::process::exit(1);
    }
}

/// Load config, build state, and serve until shutdown.
async fn run() -> anyhow::Result<()> {
    init_tracing();

    let config = Config::from_env().context("failed to load configuration")?;
    log_startup(&config);

    let signer = Signer::new(&config.signing_secret);
    let relay = Relay::new(signer, config.max_retries, config.retry_base_ms);
    let subscribers = SubscriberRegistry::new();

    let state = AppState { subscribers, relay };
    let app = router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;

    tracing::info!(%addr, "webhook-relay listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    tracing::info!("webhook-relay shut down cleanly");
    Ok(())
}

/// Initialize tracing from `RUST_LOG`, defaulting to `info`.
fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("webhook_relay=info,info"));
    fmt().with_env_filter(filter).init();
}

/// Resolve when the process receives Ctrl-C (or SIGTERM on Unix).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }

    tracing::info!("shutdown signal received");
}

/// Emit a one-line startup summary (never logs the signing secret).
fn log_startup(config: &Config) {
    tracing::info!(
        port = config.port,
        max_retries = config.max_retries,
        retry_base_ms = config.retry_base_ms,
        "SettleKit webhook relay starting"
    );
}
