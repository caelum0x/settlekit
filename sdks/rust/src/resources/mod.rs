//! Resource accessors hanging off [`Client`](crate::Client).
//!
//! Each submodule maps to a SettleKit API route group and exposes a builder
//! struct (e.g. [`products::Products`]) returned by a method on the client.
//! Request/response argument types live alongside the methods that use them.

pub mod analytics;
pub mod api_keys;
pub mod auth;
pub mod checkout;
pub mod coupons;
pub mod disputes;
pub mod dunning;
pub mod entitlements;
pub mod invoices;
pub mod license_keys;
pub mod marketplace;
pub mod payments;
pub mod payouts;
pub mod products;
pub mod refunds;
pub mod settings;
pub mod subscriptions;
pub mod usage;
pub mod webhooks;

use crate::Client;

impl Client {
    /// Product + price operations under `/v1/products`.
    pub fn products(&self) -> products::Products<'_> {
        products::Products::new(self)
    }

    /// Checkout-session operations under `/v1/checkout-sessions`.
    pub fn checkout(&self) -> checkout::Checkout<'_> {
        checkout::Checkout::new(self)
    }

    /// Payment lifecycle operations under `/v1/payments`.
    pub fn payments(&self) -> payments::Payments<'_> {
        payments::Payments::new(self)
    }

    /// Entitlement (access) operations under `/v1/entitlements`.
    pub fn entitlements(&self) -> entitlements::Entitlements<'_> {
        entitlements::Entitlements::new(self)
    }

    /// License-key operations under `/v1/license-keys`.
    pub fn license_keys(&self) -> license_keys::LicenseKeys<'_> {
        license_keys::LicenseKeys::new(self)
    }

    /// Scoped API-key operations under `/v1/api-keys`.
    pub fn api_keys(&self) -> api_keys::ApiKeys<'_> {
        api_keys::ApiKeys::new(self)
    }

    /// Coupon (discount) operations under `/v1/coupons`.
    pub fn coupons(&self) -> coupons::Coupons<'_> {
        coupons::Coupons::new(self)
    }

    /// Invoice operations under `/v1/invoices`.
    pub fn invoices(&self) -> invoices::Invoices<'_> {
        invoices::Invoices::new(self)
    }

    /// Refund operations under `/v1/refunds`.
    pub fn refunds(&self) -> refunds::Refunds<'_> {
        refunds::Refunds::new(self)
    }

    /// Recurring subscription operations under `/v1/subscriptions`.
    pub fn subscriptions(&self) -> subscriptions::Subscriptions<'_> {
        subscriptions::Subscriptions::new(self)
    }

    /// Dispute operations under `/v1/disputes`.
    pub fn disputes(&self) -> disputes::Disputes<'_> {
        disputes::Disputes::new(self)
    }

    /// Dunning (failed-payment recovery) operations under `/v1/dunning`.
    pub fn dunning(&self) -> dunning::Dunning<'_> {
        dunning::Dunning::new(self)
    }

    /// Organization settings under `/v1/settings`.
    pub fn settings(&self) -> settings::Settings<'_> {
        settings::Settings::new(self)
    }

    /// Payout (merchant settlement) operations under `/v1/payouts`.
    pub fn payouts(&self) -> payouts::Payouts<'_> {
        payouts::Payouts::new(self)
    }

    /// Public authentication operations under `/v1/auth`.
    pub fn auth(&self) -> auth::Auth<'_> {
        auth::Auth::new(self)
    }

    /// Usage metering + prepaid credits under `/v1/usage`.
    pub fn usage(&self) -> usage::Usage<'_> {
        usage::Usage::new(self)
    }

    /// Public marketplace listings + discovery under `/v1/marketplace`.
    pub fn marketplace(&self) -> marketplace::Marketplace<'_> {
        marketplace::Marketplace::new(self)
    }

    /// Merchant analytics summary under `/v1/analytics`.
    pub fn analytics(&self) -> analytics::Analytics<'_> {
        analytics::Analytics::new(self)
    }

    /// Webhook endpoint + event operations under `/v1/webhooks`. For verifying
    /// delivered event signatures, use the free functions in
    /// [`webhooks`](crate::resources::webhooks) (e.g.
    /// [`verify_signature`](crate::resources::webhooks::verify_signature)).
    pub fn webhooks(&self) -> webhooks::Webhooks<'_> {
        webhooks::Webhooks::new(self)
    }
}
