//! Invoice resource (`/v1/invoices`).

use std::collections::BTreeMap;

use reqwest::Method;
use serde::Serialize;

use crate::{Client, Invoice, Result};

/// Accessor for invoice operations.
#[derive(Debug)]
pub struct Invoices<'a> {
    client: &'a Client,
}

/// A line item for invoice creation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvoiceLineItem {
    pub description: String,
    pub quantity: i64,
    pub unit_amount: String,
}

/// A tax rate applied to an invoice.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxRate {
    pub jurisdiction: String,
    pub rate_bps: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inclusive: Option<bool>,
}

/// Body for creating a draft invoice (`POST /v1/invoices`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvoice {
    pub organization_id: String,
    pub customer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_items: Option<Vec<CreateInvoiceLineItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tax_rate: Option<TaxRate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
}

impl<'a> Invoices<'a> {
    pub(crate) fn new(client: &'a Client) -> Self {
        Invoices { client }
    }

    /// Create a draft invoice.
    pub async fn create(&self, body: &CreateInvoice) -> Result<Invoice> {
        self.client
            .request(Method::POST, "/v1/invoices", Some(body))
            .await
    }

    /// List invoices, optionally filtered by customer.
    pub async fn list(&self, customer_id: Option<&str>) -> Result<Vec<Invoice>> {
        let path = match customer_id {
            Some(cid) => format!("/v1/invoices?customerId={}", encode(cid)),
            None => "/v1/invoices".to_string(),
        };
        self.client.request_no_body(Method::GET, &path).await
    }

    /// Fetch an invoice by id.
    pub async fn get(&self, id: &str) -> Result<Invoice> {
        self.client
            .request_no_body(Method::GET, &format!("/v1/invoices/{id}"))
            .await
    }

    /// Transition a draft invoice to `open`.
    pub async fn finalize(&self, id: &str) -> Result<Invoice> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/invoices/{id}/finalize"), None)
            .await
    }

    /// Mark an open invoice as paid.
    pub async fn pay(&self, id: &str) -> Result<Invoice> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/invoices/{id}/pay"), None)
            .await
    }

    /// Void a draft or open invoice.
    pub async fn void(&self, id: &str) -> Result<Invoice> {
        self.client
            .request::<_, ()>(Method::POST, &format!("/v1/invoices/{id}/void"), None)
            .await
    }
}

/// Minimal percent-encoding for query-string values.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
