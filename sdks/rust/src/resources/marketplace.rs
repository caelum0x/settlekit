//! Marketplace resource (`/v1/marketplace`) — public listings + discovery.

use reqwest::Method;
use serde::Serialize;

use crate::{Client, Result};

/// Accessor for marketplace operations.
#[derive(Debug)]
pub struct Marketplace<'a> {
    client: &'a Client,
}

/// Body for creating a listing (`POST /v1/marketplace/listings`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateListing {
    pub organization_id: String,
    pub merchant_id: String,
    pub product_id: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

impl<'a> Marketplace<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Marketplace { client }
    }

    /// Create an (unpublished) listing for a product.
    pub async fn create_listing(&self, body: &CreateListing) -> Result<serde_json::Value> {
        self.client
            .request(Method::POST, "/v1/marketplace/listings", Some(body))
            .await
    }

    /// Search published listings. `sort` is one of `top` | `new` | `price`.
    pub async fn search(
        &self,
        query: Option<&str>,
        tag: Option<&str>,
        sort: Option<&str>,
    ) -> Result<serde_json::Value> {
        let mut params: Vec<String> = Vec::new();
        if let Some(q) = query {
            params.push(format!("q={q}"));
        }
        if let Some(t) = tag {
            params.push(format!("tag={t}"));
        }
        if let Some(s) = sort {
            params.push(format!("sort={s}"));
        }
        let path = if params.is_empty() {
            "/v1/marketplace/listings".to_string()
        } else {
            format!("/v1/marketplace/listings?{}", params.join("&"))
        };
        self.client.request_no_body(Method::GET, &path).await
    }

    /// Retrieve a listing by id.
    pub async fn get(&self, id: &str) -> Result<serde_json::Value> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/marketplace/listings/{id}"))
            .await
    }

    /// Publish a listing (make it discoverable).
    pub async fn publish(&self, id: &str) -> Result<serde_json::Value> {
        self.client
            .request_no_body(
                Method::POST,
                &format!("/v1/marketplace/listings/{id}/publish"),
            )
            .await
    }

    /// Add a 1–5 star rating to a listing.
    pub async fn rate(&self, id: &str, stars: u8) -> Result<serde_json::Value> {
        #[derive(Serialize)]
        struct Rate {
            stars: u8,
        }
        self.client
            .request(
                Method::POST,
                &format!("/v1/marketplace/listings/{id}/rate"),
                Some(&Rate { stars }),
            )
            .await
    }

    /// Fetch a seller's aggregate profile.
    pub async fn seller(&self, merchant_id: &str) -> Result<serde_json::Value> {
        self.client
            .request_no_body(
                Method::GET,
                &format!("/v1/marketplace/sellers/{merchant_id}"),
            )
            .await
    }
}
