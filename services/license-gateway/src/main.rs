//! license-gateway: a high-performance Rust verification gateway that fronts the
//! SettleKit API with an in-memory TTL cache.
//!
//! Responsibilities:
//! - Initialize structured tracing.
//! - Load and validate configuration from the environment.
//! - Construct the upstream client and TTL cache.
//! - Build the axum router and serve until shutdown.

mod cache;
mod client;
mod config;
mod error;
mod routes;

use std::net::SocketAddr;

use anyhow::Context;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::cache::TtlCache;
use crate::client::SettleKitClient;
use crate::config::Config;
use crate::routes::{router, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let config = Config::from_env().context("failed to load configuration from environment")?;
    tracing::info!(
        api_url = %config.api_url,
        port = config.port,
        cache_ttl_secs = config.cache_ttl.as_secs(),
        "starting license-gateway"
    );

    let client = SettleKitClient::new(&config).context("failed to build SettleKit client")?;
    let cache: TtlCache<bool> = TtlCache::new(config.cache_ttl);
    let state = AppState { client, cache };

    let app = router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind to {addr}"))?;
    tracing::info!(%addr, "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    tracing::info!("license-gateway shut down cleanly");
    Ok(())
}

/// Configure the tracing subscriber, honoring `RUST_LOG` when present.
fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,license_gateway=info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().compact())
        .init();
}

/// Resolve when the process receives Ctrl-C (or SIGTERM on Unix), enabling a
/// graceful drain of in-flight requests.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl-C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}
