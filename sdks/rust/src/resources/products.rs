//! Product + price resource (`/v1/products`).

use std::collections::BTreeMap;

use reqwest::Method;
use serde::Serialize;

use crate::{Client, Price, Product, Result};

/// Accessor for product and price operations.
#[derive(Debug)]
pub struct Products<'a> {
    client: &'a Client,
}

/// Body for creating a product draft (`POST /v1/products`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProduct {
    pub merchant_id: String,
    pub organization_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub product_type: String,
    pub delivery_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, serde_json::Value>>,
}

/// Body for creating a price (`POST /v1/products/:id/prices`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrice {
    pub amount: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_based: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits_granted: Option<i64>,
}

impl<'a> Products<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Products { client }
    }

    /// Create a draft product.
    pub async fn create(&self, body: &CreateProduct) -> Result<Product> {
        self.client
            .request(Method::POST, "/v1/products", Some(body))
            .await
    }

    /// List all products.
    pub async fn list(&self) -> Result<Vec<Product>> {
        self.client
            .request_no_body(Method::GET, "/v1/products")
            .await
    }

    /// Fetch a single product by id.
    pub async fn get(&self, id: &str) -> Result<Product> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/products/{id}"))
            .await
    }

    /// Publish a product (requires an active price).
    pub async fn publish(&self, id: &str) -> Result<Product> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/products/{id}/publish"), None)
            .await
    }

    /// Create a price for a product.
    pub async fn create_price(&self, product_id: &str, body: &CreatePrice) -> Result<Price> {
        self.client
            .request(
                Method::POST,
                &format!("/v1/products/{product_id}/prices"),
                Some(body),
            )
            .await
    }

    /// List prices for a product.
    pub async fn list_prices(&self, product_id: &str) -> Result<Vec<Price>> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/products/{product_id}/prices"))
            .await
    }
}
