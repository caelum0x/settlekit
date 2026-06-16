//! Coupon (discount) resource (`/v1/coupons`).

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::{Client, Coupon, CouponDiscount, Result};

/// Accessor for coupon operations.
#[derive(Debug)]
pub struct Coupons<'a> {
    client: &'a Client,
}

/// Body for creating a coupon (`POST /v1/coupons`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCoupon {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub discount: CouponDiscount,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_redemptions: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_customer_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_subtotal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applies_to_product_ids: Option<Vec<String>>,
}

/// Body for validating/redeeming a coupon against a subtotal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCoupon {
    pub subtotal: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
}

/// Outcome of validating or redeeming a coupon. Fields are captured loosely
/// since the engine returns a result/outcome shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(transparent)]
pub struct CouponApplyResult(pub serde_json::Value);

impl<'a> Coupons<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Coupons { client }
    }

    /// Create a coupon.
    pub async fn create(&self, body: &CreateCoupon) -> Result<Coupon> {
        self.client
            .request(Method::POST, "/v1/coupons", Some(body))
            .await
    }

    /// List coupons.
    pub async fn list(&self) -> Result<Vec<Coupon>> {
        self.client
            .request_no_body(Method::GET, "/v1/coupons")
            .await
    }

    /// Fetch a coupon by code.
    pub async fn get(&self, code: &str) -> Result<Coupon> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/coupons/{code}"))
            .await
    }

    /// Dry-run apply a coupon against a subtotal (no mutation).
    pub async fn validate(&self, code: &str, body: &ApplyCoupon) -> Result<CouponApplyResult> {
        self.client
            .request(
                Method::POST,
                &format!("/v1/coupons/{code}/validate"),
                Some(body),
            )
            .await
    }

    /// Redeem a coupon against a subtotal (increments its redemption count).
    pub async fn redeem(&self, code: &str, body: &ApplyCoupon) -> Result<CouponApplyResult> {
        self.client
            .request(
                Method::POST,
                &format!("/v1/coupons/{code}/redeem"),
                Some(body),
            )
            .await
    }
}
