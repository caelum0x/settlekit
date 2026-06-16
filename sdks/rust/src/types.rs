//! Serde data models mirroring the SettleKit API JSON shapes.
//!
//! Field names use `camelCase` on the wire (matching the Hono API), so every
//! struct carries `#[serde(rename_all = "camelCase")]`. Optional fields are
//! modeled as [`Option`] and skipped when serializing so request bodies stay
//! minimal. Monetary values use [`Money`] (a decimal string + currency) and are
//! never represented as floating point.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A monetary value: a decimal-string amount in the major unit plus currency.
///
/// USDC has 6 decimal places on-chain; the SDK never uses floating point for
/// money. The `amount` is a normalized decimal string such as `"25.5"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Money {
    /// Decimal string in the major unit, e.g. `"25.5"` or `"0.005"`.
    pub amount: String,
    /// ISO currency code; SettleKit settles in `"USDC"`.
    pub currency: String,
}

impl Money {
    /// Construct a `Money` value with the default `USDC` currency.
    pub fn usdc(amount: impl Into<String>) -> Self {
        Money {
            amount: amount.into(),
            currency: "USDC".to_string(),
        }
    }
}

/// Sellable product types supported by SettleKit.
pub type ProductType = String;
/// Delivery mechanisms a product can use.
pub type DeliveryMode = String;
/// Lifecycle status of a product or bundle (`draft` / `active` / `archived`).
pub type ProductStatus = String;
/// Pricing cadence (`one_time` / `monthly` / `yearly`).
pub type PriceInterval = String;
/// Settlement / payment network (`arc` / `base` / `ethereum`).
pub type Network = String;

/// A product in the catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub merchant_id: String,
    pub organization_id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub product_type: ProductType,
    pub status: ProductStatus,
    pub delivery_mode: DeliveryMode,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

/// A price attached to a product.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    pub id: String,
    pub product_id: String,
    pub amount: String,
    pub currency: String,
    pub interval: PriceInterval,
    pub usage_based: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub unit_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub credits_granted: Option<i64>,
    pub active: bool,
    pub created_at: String,
}

/// A buyer/customer record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub organization_id: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wallet_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub github_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub discord_user_id: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    pub created_at: String,
}

/// A single line item within a checkout session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutLineItem {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub product_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bundle_id: Option<String>,
    pub price_id: String,
    pub quantity: i64,
}

/// A checkout session — the unit of purchase.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSession {
    pub id: String,
    pub organization_id: String,
    pub merchant_id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub customer_id: Option<String>,
    pub line_items: Vec<CheckoutLineItem>,
    pub amount: Money,
    pub status: String,
    pub pay_to_address: String,
    pub network: Network,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub success_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cancel_url: Option<String>,
    pub expires_at: String,
    #[serde(default)]
    pub collected_fields: BTreeMap<String, String>,
    pub created_at: String,
}

/// A payment recorded against a checkout session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    pub organization_id: String,
    pub checkout_session_id: String,
    pub customer_id: String,
    pub amount: Money,
    pub network: Network,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tx_hash: Option<String>,
    pub confirmations: i64,
    pub status: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub confirmed_at: Option<String>,
}

/// Identifies what granted an entitlement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementGrantedBy {
    #[serde(rename = "type")]
    pub grant_type: String,
    pub id: String,
}

/// An entitlement: the universal access-grant primitive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlement {
    pub id: String,
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub granted_by: EntitlementGrantedBy,
    pub entitlement_type: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resource_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub features: Option<BTreeMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub credits_remaining: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub seats: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A machine/domain-limited license key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseKey {
    pub id: String,
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub entitlement_id: String,
    pub key: String,
    pub status: String,
    pub machine_limit: i64,
    #[serde(default)]
    pub activated_machine_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub domain_limit: Option<i64>,
    #[serde(default)]
    pub activated_domains: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expires_at: Option<String>,
    pub created_at: String,
}

/// A scoped API key issued to a customer. The plaintext is only ever returned
/// once at issuance (see [`crate::resources::api_keys::IssuedApiKey`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKey {
    pub id: String,
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub entitlement_id: String,
    pub key_hash: String,
    pub key_prefix: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_used_at: Option<String>,
    pub created_at: String,
}

/// A bundle of products sold together.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub id: String,
    pub merchant_id: String,
    pub organization_id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub product_ids: Vec<String>,
    pub price: Money,
    pub interval: PriceInterval,
    pub status: ProductStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// The discount a coupon applies. The `type` discriminator selects the variant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum CouponDiscount {
    /// A whole-percent reduction of the subtotal.
    Percent {
        #[serde(rename = "percentOff")]
        percent_off: i64,
    },
    /// A fixed monetary amount off the subtotal.
    Amount {
        #[serde(rename = "amountOff")]
        amount_off: Money,
    },
    /// No monetary discount; grants N free trial days.
    FreeTrialDays { days: i64 },
}

/// A discount coupon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coupon {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
    pub discount: CouponDiscount,
    pub currency: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub starts_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_redemptions: Option<i64>,
    #[serde(default)]
    pub redeemed_count: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub per_customer_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub min_subtotal: Option<Money>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub applies_to_product_ids: Option<Vec<String>>,
}

/// A single invoice line item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceLineItem {
    pub description: String,
    pub quantity: i64,
    pub unit_amount: Money,
}

/// A customer invoice.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoice {
    pub id: String,
    pub number: String,
    pub organization_id: String,
    pub customer_id: String,
    #[serde(default)]
    pub line_items: Vec<InvoiceLineItem>,
    pub subtotal: Money,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub discount: Option<Money>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tax: Option<Money>,
    pub total: Money,
    pub currency: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub issued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub paid_at: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

/// A refund against a confirmed payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Refund {
    pub id: String,
    pub payment_id: String,
    pub customer_id: String,
    pub amount: Money,
    pub reason: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub failure_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A single piece of evidence attached to a dispute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisputeEvidence {
    pub id: String,
    pub kind: String,
    pub description: String,
    pub value: String,
    pub submitted_at: String,
}

/// A dispute opened against a confirmed payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dispute {
    pub id: String,
    pub payment_id: String,
    pub customer_id: String,
    pub reason: String,
    pub status: String,
    #[serde(default)]
    pub evidence: Vec<DisputeEvidence>,
    pub opened_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resolved_at: Option<String>,
}

/// One recorded dunning attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DunningAttemptRecord {
    pub attempt: u32,
    pub outcome: String,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub failure_reason: Option<String>,
}

/// The recovery state of a subscription's dunning campaign.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DunningState {
    pub subscription_id: String,
    pub attempt: u32,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub next_attempt_at: Option<String>,
    #[serde(default)]
    pub history: Vec<DunningAttemptRecord>,
    pub started_at: String,
    pub updated_at: String,
}

/// The merchant dashboard's editable organization config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSettings {
    pub org_name: String,
    pub support_email: String,
    pub payout_currency: String,
    pub webhook_secret: String,
    pub default_rail: String,
}

/// A recurring subscription bound to a customer and a recurring price.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: String,
    pub organization_id: String,
    pub customer_id: String,
    pub product_id: String,
    pub price_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub interval: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub amount: Option<Money>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub current_period_start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub current_period_end: Option<String>,
    #[serde(default)]
    pub cancel_at_period_end: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub updated_at: Option<String>,
}

/// A settlement of funds from the platform to a merchant wallet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payout {
    pub id: String,
    pub organization_id: String,
    pub wallet_address: String,
    pub amount: Money,
    pub network: Network,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub failure_reason: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub paid_at: Option<String>,
}
