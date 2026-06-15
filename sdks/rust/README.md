# settlekit

Official async Rust SDK for the [SettleKit](https://settlekit.dev) commerce API.

It mirrors the SettleKit REST surface under `/v1`, authenticates with a Bearer
API key, and decodes the uniform `{ data }` / `{ error }` envelope into
strongly-typed Rust values. Built on [`reqwest`](https://crates.io/crates/reqwest)
and [`serde`](https://crates.io/crates/serde).

## Features

- Fully async (`async`/`await`), built on `reqwest`.
- Strongly-typed request and response models (`serde`).
- Uniform error handling via a single `Error` enum (`thiserror`).
- Automatic `Idempotency-Key` header on every write request.
- Configurable base URL (defaults to `http://localhost:8787`).

## Installation

Add the crate to your `Cargo.toml`:

```toml
[dependencies]
settlekit = "0.1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

## Authentication

Every request under `/v1` requires a Bearer API key:

```rust
use settlekit::Client;

// Default base URL: http://localhost:8787
let client = Client::new("sk_live_your_api_key");

// Or point at a hosted environment:
let client = Client::new("sk_live_your_api_key")
    .with_base_url("https://api.settlekit.dev");
```

## Resources

The client exposes one accessor per API route group:

| Accessor                 | Routes                       |
| ------------------------ | ---------------------------- |
| `client.products()`      | `/v1/products`               |
| `client.checkout()`      | `/v1/checkout-sessions`      |
| `client.payments()`      | `/v1/payments`               |
| `client.entitlements()`  | `/v1/entitlements`           |
| `client.license_keys()`  | `/v1/license-keys`           |
| `client.api_keys()`      | `/v1/api-keys`               |
| `client.coupons()`       | `/v1/coupons`                |
| `client.invoices()`      | `/v1/invoices`               |
| `client.refunds()`       | `/v1/refunds`                |
| `client.payouts()`       | `/v1/payouts`                |
| `client.auth()`          | `/v1/auth` (public)          |

## Runnable example

A complete end-to-end flow — create a product, attach a price, publish it, open
a checkout session, record and confirm a payment, then verify the resulting
entitlement:

```rust,no_run
use std::collections::BTreeMap;

use settlekit::resources::checkout::{CheckoutItem, CreateCheckoutSession};
use settlekit::resources::entitlements::VerifyAccess;
use settlekit::resources::payments::{ConfirmPayment, RecordPayment};
use settlekit::resources::products::{CreatePrice, CreateProduct};
use settlekit::{Client, Result};

#[tokio::main]
async fn main() -> Result<()> {
    // Point at your SettleKit API; the default is http://localhost:8787.
    let client = Client::new("sk_live_your_api_key")
        .with_base_url("http://localhost:8787");

    // 1. Create a product draft.
    let product = client
        .products()
        .create(&CreateProduct {
            merchant_id: "merchant_123".into(),
            organization_id: "org_123".into(),
            name: "Pro API Access".into(),
            description: Some("Monthly access to the Pro API tier".into()),
            product_type: "api_access".into(),
            delivery_mode: "api_key".into(),
            metadata: None,
        })
        .await?;
    println!("created product {}", product.id);

    // 2. Attach a price.
    let price = client
        .products()
        .create_price(
            &product.id,
            &CreatePrice {
                amount: "25.00".into(),
                currency: Some("USDC".into()),
                interval: Some("monthly".into()),
                usage_based: Some(false),
                unit_amount: None,
                credits_granted: None,
            },
        )
        .await?;

    // 3. Publish the product (requires an active price).
    let product = client.products().publish(&product.id).await?;
    println!("product status: {}", product.status);

    // 4. Open a checkout session for a known customer.
    let session = client
        .checkout()
        .create(&CreateCheckoutSession {
            organization_id: "org_123".into(),
            merchant_id: "merchant_123".into(),
            customer_id: Some("customer_123".into()),
            items: vec![CheckoutItem {
                price_id: price.id.clone(),
                product_id: Some(product.id.clone()),
                bundle_id: None,
                quantity: Some(1),
            }],
            pay_to_address: "0xMerchantWallet".into(),
            network: "base".into(),
            success_url: None,
            cancel_url: None,
            collected_fields: None,
            ttl_days: Some(7),
        })
        .await?;
    println!("checkout total: {} {}", session.amount.amount, session.amount.currency);

    // 5. Record a pending payment, then confirm it on-chain.
    let payment = client
        .payments()
        .record(&RecordPayment {
            checkout_session_id: session.id.clone(),
            tx_hash: Some("0xpending".into()),
        })
        .await?;

    let confirmed = client
        .payments()
        .confirm(
            &payment.id,
            &ConfirmPayment {
                tx_hash: "0xconfirmedhash".into(),
                confirmations: 12,
                min_confirmations: Some(6),
            },
        )
        .await?;
    println!(
        "payment {} confirmed; {} entitlement(s) granted",
        confirmed.payment.id,
        confirmed.entitlements.len()
    );

    // 6. Verify the customer now has access.
    let access = client
        .entitlements()
        .verify(&VerifyAccess {
            customer_id: "customer_123".into(),
            product_id: Some(product.id.clone()),
            feature: None,
            required_credits: None,
        })
        .await?;
    println!("access granted: {}", access.granted);

    // (collect_fields takes a plain map of buyer-supplied delivery inputs.)
    let _fields: BTreeMap<String, String> = BTreeMap::new();

    Ok(())
}
```

## Error handling

All fallible calls return `Result<T, settlekit::Error>`:

```rust,no_run
use settlekit::{Client, Error};

# async fn run() -> () {
let client = Client::new("sk_live_your_api_key");
match client.products().get("does_not_exist").await {
    Ok(product) => println!("{}", product.name),
    Err(Error::Api { code, message, status, .. }) => {
        eprintln!("API error {status} ({code}): {message}");
    }
    Err(Error::Http(e)) => eprintln!("transport error: {e}"),
    Err(Error::Decode(e)) => eprintln!("decode error: {e}"),
}
# }
```

## License

MIT
