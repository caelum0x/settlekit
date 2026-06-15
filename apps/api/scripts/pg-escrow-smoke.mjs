import { createApp } from "../dist/app.js";
import { createContext } from "../dist/context.js";

const KEY = process.env.API_BOOTSTRAP_KEY ?? "smoke-key";

async function main() {
  const ctx = await createContext();
  const app = createApp(ctx);
  const call = async (method, path, body) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json() };
  };
  const log = (l, r) => { console.log(`${l}: ${r.status} ${r.json.error ? JSON.stringify(r.json.error) : r.json.data?.status ?? "ok"}`); if (r.status >= 400) throw new Error(`${l}: ${JSON.stringify(r.json)}`); };

  const t = await call("POST", "/v1/escrow/tasks", {
    organizationId: "org_1", buyerCustomerId: "cus_buyer", title: "Build a widget",
    description: "Implement the widget", amount: "100.00",
  });
  log("create", t);
  const id = t.json.data.id;

  log("fund", await call("POST", `/v1/escrow/tasks/${id}/fund`, { fundingTxHash: "0xfund1" }));
  log("assign", await call("POST", `/v1/escrow/tasks/${id}/assign`, { workerCustomerId: "cus_worker" }));
  log("submit", await call("POST", `/v1/escrow/tasks/${id}/submit`, { content: "here is the work" }));
  log("approve", await call("POST", `/v1/escrow/tasks/${id}/approve`));
  log("release", await call("POST", `/v1/escrow/tasks/${id}/release`, { releaseTxHash: "0xrelease1" }));

  const list = await call("GET", "/v1/escrow/tasks?organizationId=org_1");
  console.log(`list count=${list.json.data.length}`);
  console.log("ESCROW_ID", id);
  console.log("ESCROW_SMOKE_OK");
}
main().catch((e) => { console.error("ESCROW_SMOKE_FAIL", e); process.exit(1); });
