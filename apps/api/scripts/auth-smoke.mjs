import { createApp } from "../dist/app.js";
import { createContext } from "../dist/context.js";

async function main() {
  const app = createApp(await createContext());
  const call = async (method, path, body, token) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json() };
  };
  const log = (l, r) => { console.log(`${l}: ${r.status} ${r.json.error ? JSON.stringify(r.json.error) : "ok"}`); if (r.status >= 400) throw new Error(`${l}: ${JSON.stringify(r.json)}`); };

  const reg = await call("POST", "/v1/auth/register", { email: "merchant@acme.dev", password: "s3cret-pass-123", type: "merchant", displayName: "Acme" });
  log("register", reg);
  const login = await call("POST", "/v1/auth/login", { email: "merchant@acme.dev", password: "s3cret-pass-123" });
  log("login", login);
  const token = login.json.data.sessionToken;
  const sess = await call("GET", "/v1/auth/session", undefined, token);
  log("session", sess);
  console.log(`  account=${sess.json.data.account.email} type=${sess.json.data.account.type}`);
  const ml = await call("POST", "/v1/auth/magic-link/request", { email: "buyer@acme.dev" });
  log("magic-link/request", ml);
  console.log(`  devToken present=${Boolean(ml.json.data.devToken)}`);
  const bad = await call("POST", "/v1/auth/login", { email: "merchant@acme.dev", password: "wrong" });
  console.log(`bad-login: ${bad.status} (expect 401) ${bad.json.error?.code}`);
  console.log("AUTH_SMOKE_OK");
}
main().catch((e) => { console.error("AUTH_SMOKE_FAIL", e); process.exit(1); });
