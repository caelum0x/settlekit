//! SettleKit license-verification CLI.
//!
//! Verifies a SettleKit license key, API key, or entitlement against the
//! SettleKit commerce API. Reads the API base URL and bearer key from the
//! environment (`SETTLEKIT_API_URL`, `SETTLEKIT_API_KEY`) or from global flags.
//!
//! Endpoints (all return the `{"data":T}` / `{"error":{...}}` envelope):
//!   - POST /v1/license-keys/verify  -> { active }
//!   - POST /v1/api-keys/verify      -> { valid }
//!   - POST /v1/entitlements/verify  -> { allowed }

use std::process::ExitCode;
use std::time::Duration;

use clap::{Args, Parser, Subcommand};
use reqwest::blocking::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Default API base URL when `SETTLEKIT_API_URL` is unset and no flag is given.
const DEFAULT_API_URL: &str = "http://localhost:8787";

/// Process exit code returned when verification succeeds but the answer is
/// "false" (e.g. license inactive). Distinct from a hard error so scripts can
/// tell "not active" apart from "request failed".
const EXIT_NEGATIVE: u8 = 1;

/// Process exit code for transport / API / parsing errors.
const EXIT_ERROR: u8 = 2;

#[derive(Parser, Debug)]
#[command(
    name = "license-check",
    about = "Verify SettleKit license keys, API keys, and entitlements.",
    version
)]
struct Cli {
    #[command(flatten)]
    global: GlobalArgs,

    #[command(subcommand)]
    command: Command,
}

#[derive(Args, Debug, Clone)]
struct GlobalArgs {
    /// SettleKit API base URL (overrides SETTLEKIT_API_URL).
    #[arg(long, global = true, env = "SETTLEKIT_API_URL", default_value = DEFAULT_API_URL)]
    api_url: String,

    /// Bearer API key used for the Authorization header (overrides SETTLEKIT_API_KEY).
    #[arg(long, global = true, env = "SETTLEKIT_API_KEY")]
    api_key: Option<String>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Verify a product license key bound to a machine.
    License {
        /// The license key string to verify.
        #[arg(long)]
        license_key: String,

        /// The product the license is issued for.
        #[arg(long)]
        product_id: String,

        /// The machine / device identifier the license is bound to.
        #[arg(long)]
        machine_id: String,
    },

    /// Verify an API key, optionally requiring a set of scopes.
    ApiKey {
        /// The API key to verify.
        #[arg(long)]
        key: String,

        /// A required scope. Repeat the flag for multiple scopes.
        #[arg(long = "scope")]
        scope: Vec<String>,
    },

    /// Verify whether a customer is entitled to a feature.
    Entitlement {
        /// The customer identifier.
        #[arg(long)]
        customer_id: String,

        /// The feature key to check.
        #[arg(long)]
        feature: String,
    },
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct LicenseVerifyRequest<'a> {
    license_key: &'a str,
    product_id: &'a str,
    machine_id: &'a str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ApiKeyVerifyRequest<'a> {
    key: &'a str,
    required_scopes: &'a [String],
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct EntitlementVerifyRequest<'a> {
    customer_id: &'a str,
    feature: &'a str,
}

// ---------------------------------------------------------------------------
// Response bodies
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug)]
struct LicenseVerifyData {
    active: bool,
}

#[derive(Deserialize, Debug)]
struct ApiKeyVerifyData {
    valid: bool,
}

#[derive(Deserialize, Debug)]
struct EntitlementVerifyData {
    allowed: bool,
}

/// The SettleKit response envelope: exactly one of `data` / `error` is present.
#[derive(Deserialize, Debug)]
struct Envelope<T> {
    data: Option<T>,
    error: Option<ApiError>,
}

#[derive(Deserialize, Debug)]
struct ApiError {
    code: String,
    message: String,
}

// ---------------------------------------------------------------------------
// Client errors
// ---------------------------------------------------------------------------

/// Errors surfaced to the user. Rendered to stderr; each maps to a non-zero
/// exit code.
#[derive(Debug)]
enum CliError {
    /// No bearer key supplied via flag or environment.
    MissingApiKey,
    /// Underlying HTTP transport failure (DNS, connection, timeout, TLS, ...).
    Transport(String),
    /// The body could not be parsed as the expected envelope.
    Parse(String),
    /// A well-formed `{"error":{code,message}}` response from the API.
    Api { code: String, message: String },
    /// A non-success HTTP status whose body was not a parseable error envelope.
    Http { status: u16, body: String },
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::MissingApiKey => write!(
                f,
                "missing API key: pass --api-key or set SETTLEKIT_API_KEY"
            ),
            CliError::Transport(msg) => write!(f, "request failed: {msg}"),
            CliError::Parse(msg) => write!(f, "failed to parse response: {msg}"),
            CliError::Api { code, message } => write!(f, "{code}: {message}"),
            CliError::Http { status, body } => {
                write!(f, "HTTP {status}: {body}")
            }
        }
    }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

/// A thin blocking client around the SettleKit verify endpoints.
struct SettleKitClient {
    http: Client,
    base_url: String,
    api_key: String,
}

impl SettleKitClient {
    fn new(base_url: String, api_key: String) -> Result<Self, CliError> {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("settlekit-license-check/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| CliError::Transport(e.to_string()))?;

        Ok(Self {
            http,
            // Normalise so we can always join with a leading-slash path.
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        })
    }

    /// POST `body` to `path` and decode the `{"data":T}` envelope.
    ///
    /// On a `{"error":{...}}` envelope (at any status) returns `CliError::Api`.
    /// On a non-2xx status without a parseable error envelope returns
    /// `CliError::Http`.
    fn post_verify<B, T>(&self, path: &str, body: &B) -> Result<T, CliError>
    where
        B: Serialize,
        T: DeserializeOwned,
    {
        let url = format!("{}{}", self.base_url, path);

        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(body)
            .send()
            .map_err(|e| CliError::Transport(e.to_string()))?;

        let status = response.status();
        let text = response
            .text()
            .map_err(|e| CliError::Transport(e.to_string()))?;

        // Try to decode the envelope regardless of status: the API returns
        // structured errors with non-2xx codes too.
        match serde_json::from_str::<Envelope<T>>(&text) {
            Ok(env) => {
                if let Some(err) = env.error {
                    return Err(CliError::Api {
                        code: err.code,
                        message: err.message,
                    });
                }
                if let Some(data) = env.data {
                    return Ok(data);
                }
                // Envelope parsed but neither field present.
                if status.is_success() {
                    Err(CliError::Parse(
                        "response envelope contained neither `data` nor `error`".to_string(),
                    ))
                } else {
                    Err(CliError::Http {
                        status: status.as_u16(),
                        body: truncate(&text),
                    })
                }
            }
            Err(parse_err) => {
                if status.is_success() {
                    Err(CliError::Parse(parse_err.to_string()))
                } else {
                    // Surface the raw HTTP failure (e.g. 502 HTML page).
                    Err(CliError::Http {
                        status: status.as_u16(),
                        body: truncate(&text),
                    })
                }
            }
        }
    }

    fn verify_license(
        &self,
        license_key: &str,
        product_id: &str,
        machine_id: &str,
    ) -> Result<bool, CliError> {
        let req = LicenseVerifyRequest {
            license_key,
            product_id,
            machine_id,
        };
        let data: LicenseVerifyData = self.post_verify("/v1/license-keys/verify", &req)?;
        Ok(data.active)
    }

    fn verify_api_key(&self, key: &str, scopes: &[String]) -> Result<bool, CliError> {
        let req = ApiKeyVerifyRequest {
            key,
            required_scopes: scopes,
        };
        let data: ApiKeyVerifyData = self.post_verify("/v1/api-keys/verify", &req)?;
        Ok(data.valid)
    }

    fn verify_entitlement(&self, customer_id: &str, feature: &str) -> Result<bool, CliError> {
        let req = EntitlementVerifyRequest {
            customer_id,
            feature,
        };
        let data: EntitlementVerifyData = self.post_verify("/v1/entitlements/verify", &req)?;
        Ok(data.allowed)
    }
}

/// Clip an error body so we never dump a huge HTML page onto stderr.
fn truncate(s: &str) -> String {
    const MAX: usize = 500;
    let trimmed = s.trim();
    if trimmed.chars().count() <= MAX {
        trimmed.to_string()
    } else {
        let head: String = trimmed.chars().take(MAX).collect();
        format!("{head}…")
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    let api_key = match cli.global.api_key {
        Some(k) if !k.is_empty() => k,
        _ => {
            eprintln!("error: {}", CliError::MissingApiKey);
            return ExitCode::from(EXIT_ERROR);
        }
    };

    let client = match SettleKitClient::new(cli.global.api_url, api_key) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(EXIT_ERROR);
        }
    };

    let outcome: Result<(&'static str, bool), CliError> = match cli.command {
        Command::License {
            license_key,
            product_id,
            machine_id,
        } => client
            .verify_license(&license_key, &product_id, &machine_id)
            .map(|active| ("active", active)),

        Command::ApiKey { key, scope } => {
            client.verify_api_key(&key, &scope).map(|valid| ("valid", valid))
        }

        Command::Entitlement {
            customer_id,
            feature,
        } => client
            .verify_entitlement(&customer_id, &feature)
            .map(|allowed| ("allowed", allowed)),
    };

    match outcome {
        Ok((label, value)) => {
            println!("{label}: {value}");
            if value {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(EXIT_NEGATIVE)
            }
        }
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(EXIT_ERROR)
        }
    }
}
