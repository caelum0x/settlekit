//! # SettleKit Rust SDK
//!
//! An async, production-grade client for the [SettleKit](https://settlekit.dev)
//! commerce API. It mirrors the REST surface (`/v1/...`), authenticates with a
//! Bearer API key, and decodes the uniform `{ data }` / `{ error }` envelope
//! into strongly-typed Rust values.
//!
//! ## Quick start
//!
//! ```no_run
//! use settlekit::Client;
//!
//! # async fn run() -> settlekit::Result<()> {
//! let client = Client::new("sk_live_your_api_key")
//!     .with_base_url("https://api.settlekit.dev");
//!
//! let products = client.products().list().await?;
//! println!("{} products", products.len());
//! # Ok(())
//! # }
//! ```
//!
//! See the crate `README.md` for a complete runnable example.

#![forbid(unsafe_code)]
#![warn(missing_debug_implementations)]

mod client;
mod error;
mod types;

pub mod resources;

pub use client::{Client, DEFAULT_BASE_URL};
pub use error::{Error, Result};
pub use types::{
    ApiKey, Bundle, CheckoutLineItem, CheckoutSession, Coupon, CouponDiscount, Customer,
    Entitlement, EntitlementGrantedBy, Invoice, InvoiceLineItem, LicenseKey, Money, Payment,
    Payout, Price, Product, Refund,
};
