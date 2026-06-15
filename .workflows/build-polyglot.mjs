export const meta = {
  name: 'settlekit-polyglot',
  description: 'Polyglot expansion: Go SDK + Rust SDK + Go x402 gateway + Rust Arc indexer (no tests, no CI)',
  phases: [{ title: 'Polyglot' }],
};

const SHARED = `
SettleKit monorepo at /Users/arhansubasi/settlekit. Production-grade REAL code only — no mocks/stubs/placeholders/TODO, no tests, no CI/CD.
The SettleKit REST API (apps/api, Hono) is the integration target: base URL configurable (default http://localhost:8787), Bearer token auth via "Authorization: Bearer <apiKey>", and a JSON envelope { "data": ... } on success / { "error": { "code", "message", "details"? } } on failure (HTTP status carries the error). Public auth endpoints live under /v1/auth (no api key). To learn exact paths + request/response shapes, READ apps/api/src/app.ts and apps/api/src/routes/*.ts and apps/api/src/http/respond.ts.
You have Bash — after writing, RUN the language build to verify it compiles, and report the exact command + result in your summary. Create ONLY files under your assigned directory. Use a clear README.md per component.
`;

const MANIFEST = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'files', 'buildCommand', 'buildResult', 'summary'],
  properties: {
    unit: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    buildCommand: { type: 'string' },
    buildResult: { type: 'string' },
    summary: { type: 'string' },
  },
};

const TASKS = [
  {
    label: 'go:sdk',
    prompt: `Build the official Go SDK at /Users/arhansubasi/settlekit/sdks/go — module path "github.com/settlekit/settlekit-go". STDLIB ONLY (net/http, encoding/json, context, time, errors, fmt) so it builds offline with zero external deps.
- go.mod (go 1.24, module github.com/settlekit/settlekit-go, no require block).
- client.go: Client struct { apiKey, baseURL, httpClient *http.Client }; New(apiKey string, opts ...Option) with WithBaseURL/WithHTTPClient options; a private do(ctx, method, path string, body any, out any) error that sets Authorization + Content-Type, marshals body, decodes the {data}/{error} envelope, and returns a typed *APIError (code/message/status) on non-2xx; an Idempotency-Key header on writes (crypto/rand hex).
- errors.go: APIError type implementing error.
- types.go: Go structs for the core domain (Product, Price, Customer, CheckoutSession, Payment, Entitlement, LicenseKey, ApiKey, Bundle, Coupon, Invoice, Refund, Payout, Money{Amount string; Currency string}) with json tags matching the API.
- resources split into files: products.go, checkout.go, payments.go, entitlements.go, licensekeys.go, apikeys.go, coupons.go, invoices.go, auth.go — each a method set on *Client (e.g. (c *Client) CreateProduct(ctx, in) (*Product, error); ConfirmPayment; VerifyEntitlement; CreateCheckoutSession; Login; Register). Map list/get/create/action endpoints you find in the routes.
- example_test-free usage in README.md (a runnable main snippet, NOT a _test.go file).
VERIFY: run \`cd /Users/arhansubasi/settlekit/sdks/go && go build ./... && go vet ./...\` and report output. It MUST build.`,
  },
  {
    label: 'rust:sdk',
    prompt: `Build the official Rust SDK crate at /Users/arhansubasi/settlekit/sdks/rust (crate name "settlekit"). Async, production-grade.
- Cargo.toml: [package] name="settlekit" version="0.1.0" edition="2021"; dependencies reqwest (default-tls, json feature) , serde (derive), serde_json, thiserror, tokio (optional for examples). Keep deps standard + minimal.
- src/lib.rs: re-export modules.
- src/client.rs: Client { api_key, base_url, http: reqwest::Client }; Client::new(api_key) + with_base_url; a private async request<T: DeserializeOwned, B: Serialize>(method, path, body) that sets bearer auth + content-type, sends, and parses the { data } / { error } envelope, returning Result<T, Error>; idempotency key header on writes.
- src/error.rs: Error enum (thiserror) — Api { code, message, status }, Http(reqwest::Error), Decode(serde_json::Error).
- src/types.rs: serde structs (Serialize/Deserialize) for Product, Price, Customer, CheckoutSession, Payment, Entitlement, LicenseKey, ApiKey, Bundle, Coupon, Invoice, Refund, Payout, Money { amount: String, currency: String } with serde rename to match API json.
- src/resources/*.rs (mod resources): products, checkout, payments, entitlements, license_keys, api_keys, coupons, invoices, auth — impl blocks on Client with async methods mapping to the API routes.
- README.md with a runnable async example (in prose / doc comment, NOT a tests dir).
VERIFY: run \`cd /Users/arhansubasi/settlekit/sdks/rust && cargo build\` and report output. It MUST compile (cargo may fetch crates from the network — that is fine). Do not add a [[bin]]; it is a library crate.`,
  },
  {
    label: 'go:x402-gateway',
    prompt: `Build a production Go microservice at /Users/arhansubasi/settlekit/services/x402-gateway — an x402 pay-per-call reverse proxy. STDLIB ONLY (net/http, net/http/httputil, encoding/json, crypto/hmac, crypto/sha256, encoding/base64, os, log, time, context) so it builds offline.
Behavior (real x402 protocol, mirrors packages/x402 semantics — READ packages/x402/src/*.ts for the header names + payment-requirements JSON shape):
- main.go: read config from env (LISTEN_ADDR default :8402, UPSTREAM_URL, PRICE, CURRENCY=USDC, NETWORK, PAY_TO, PRODUCT_ID, RESOURCE, optional VERIFY_URL to POST a payment proof for verification, NONCE optional stable nonce). Start an http.Server with graceful shutdown on SIGINT/SIGTERM.
- gateway.go: the handler — if no "X-Payment" header, respond 402 with the payment-requirements JSON in body + X-Payment-Required + Accept-Payment headers (scheme x402, amount, asset, network, payTo, productId, resource, nonce). If X-Payment present (base64 JSON { txHash, from, amount, network, nonce }), verify it: if VERIFY_URL is set POST the proof and require {ok:true}; otherwise verify the nonce matches + amount >= price locally; on success reverse-proxy the request to UPSTREAM_URL via httputil.NewSingleHostReverseProxy; on failure return 402 with a reason.
- requirements.go / payment.go: build/parse the payment headers (base64 JSON), HMAC-signed nonce helper.
- README.md documenting env vars + the flow.
VERIFY: run \`cd /Users/arhansubasi/settlekit/services/x402-gateway && go build ./... && go vet ./...\` and report. MUST build. Use module github.com/settlekit/x402-gateway in go.mod (go 1.24, no external require).`,
  },
  {
    label: 'rust:arc-indexer',
    prompt: `Build a production Rust binary at /Users/arhansubasi/settlekit/services/arc-indexer — watches an Arc/EVM RPC for USDC ERC-20 Transfer events to a watched payout address and POSTs payment confirmations to the SettleKit API. Real code.
- Cargo.toml: [package] name="settlekit-arc-indexer" edition="2021"; [[bin]] name="arc-indexer"; deps: tokio (rt-multi-thread, macros, time), reqwest (json), serde (derive), serde_json, thiserror, hex. Keep standard + minimal.
- src/main.rs: tokio main — load config from env (ARC_RPC_URL, ARC_USDC_ADDRESS, WATCH_ADDRESS, SETTLEKIT_API_URL, SETTLEKIT_API_KEY, POLL_INTERVAL_SECS default 12, CONFIRMATIONS default 3, START_BLOCK optional). Loop: poll eth_blockNumber, fetch logs (eth_getLogs filtered by the USDC contract + the Transfer(address,address,uint256) topic0 keccak + the watched 'to' topic), decode each transfer (from/to/value from topics+data, hex), wait for CONFIRMATIONS, then POST to {API_URL}/v1/payments/{?}/confirm OR a generic confirm webhook with { txHash, from, amount, confirmations } using the bearer key. Track last processed block in memory; graceful Ctrl-C.
- src/rpc.rs: a minimal JSON-RPC client over reqwest (eth_blockNumber, eth_getLogs) with typed responses.
- src/usdc.rs: the Transfer topic0 constant (keccak256("Transfer(address,address,uint256)") = 0xddf252ad...), address topic padding helper, and a decode_transfer(log) -> { from, to, value: u128/String }.
- src/config.rs, src/error.rs (thiserror).
- README.md.
Use the well-known Transfer topic0 hex literal directly (no keccak dependency needed). VERIFY: run \`cd /Users/arhansubasi/settlekit/services/arc-indexer && cargo build\` and report. MUST compile (network fetch of crates is fine).`,
  },
];

phase('Polyglot');
const results = await parallel(
  TASKS.map((t) => () => agent(`${t.prompt}\n\n${SHARED}\n\nWrite all files, run the build to verify, then return the manifest.`, {
    label: t.label, phase: 'Polyglot', schema: MANIFEST,
  }))
);
log(`Polyglot: ${results.filter(Boolean).length}/${TASKS.length} units`);
return { built: results.filter(Boolean) };
