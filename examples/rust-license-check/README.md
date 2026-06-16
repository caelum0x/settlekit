# license-check — SettleKit verification CLI (Rust)

A small, runnable Rust CLI that verifies a SettleKit **license key**, **API key**,
or **entitlement** against the SettleKit commerce API.

It uses the blocking `reqwest` client, sends `Authorization: Bearer <key>`,
parses the standard `{"data":T}` / `{"error":{code,message}}` envelope, and maps
results to process exit codes so it composes well in scripts and CI.

## Endpoints used

| Subcommand    | Method & path                  | Request body                          | Result field |
|---------------|--------------------------------|---------------------------------------|--------------|
| `license`     | `POST /v1/license-keys/verify` | `{licenseKey, productId, machineId}`  | `active`     |
| `api-key`     | `POST /v1/api-keys/verify`     | `{key, requiredScopes:[]}`            | `valid`      |
| `entitlement` | `POST /v1/entitlements/verify` | `{customerId, feature}`               | `allowed`    |

## Build

```bash
cargo build --release
# binary at: target/release/license-check
```

## Configuration

The CLI reads two environment variables (each can be overridden by a global flag):

| Variable             | Flag        | Default                  | Notes                              |
|----------------------|-------------|--------------------------|------------------------------------|
| `SETTLEKIT_API_URL`  | `--api-url` | `http://localhost:8787`  | API base URL.                      |
| `SETTLEKIT_API_KEY`  | `--api-key` | _(required)_             | Bearer token for `Authorization`.  |

```bash
export SETTLEKIT_API_URL="http://localhost:8787"
export SETTLEKIT_API_KEY="sk_live_xxx"
```

If no API key is supplied via flag or env, the CLI exits with an error.

## Usage

```bash
license-check <SUBCOMMAND> [OPTIONS]
license-check --help
```

### Verify a license key

```bash
license-check license \
  --license-key "LK-ABCD-1234" \
  --product-id "prod_research" \
  --machine-id "machine-42"
# -> active: true
```

### Verify an API key (optionally requiring scopes)

```bash
# No scopes required:
license-check api-key --key "sk_live_xxx"

# Require one or more scopes (repeat --scope):
license-check api-key --key "sk_live_xxx" --scope read:invoices --scope write:invoices
# -> valid: true
```

### Verify an entitlement

```bash
license-check entitlement \
  --customer-id "cus_123" \
  --feature "research_export"
# -> allowed: true
```

### Overriding URL / key per invocation

```bash
license-check \
  --api-url "https://api.settlekit.example" \
  --api-key "sk_live_xxx" \
  entitlement --customer-id "cus_123" --feature "research_export"
```

## Output & exit codes

The CLI prints `"<field>: true"` or `"<field>: false"` to **stdout**, and errors
to **stderr**.

| Exit code | Meaning                                                                 |
|-----------|-------------------------------------------------------------------------|
| `0`       | Verified **true** (`active` / `valid` / `allowed`).                      |
| `1`       | Verified **false** — request succeeded but the answer was negative.     |
| `2`       | Error — missing key, transport failure, unparseable body, or API error. |

This separation lets scripts distinguish "not active" from "request failed":

```bash
if license-check license --license-key "$LK" --product-id "$P" --machine-id "$M"; then
  echo "license is active"
else
  case $? in
    1) echo "license is NOT active" ;;
    *) echo "verification could not be performed" >&2 ;;
  esac
fi
```

On a `{"error":{code,message}}` response the CLI prints `error: <code>: <message>`
to stderr and exits `2`.

## Cargo.toml

```toml
[package]
name = "license-check"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "license-check"
path = "src/main.rs"

[dependencies]
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive", "env"] }
```
