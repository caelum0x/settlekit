/**
 * Circle Gas Station client — manage gas-sponsorship **policies** over the
 * Circle Web3 Services REST API.
 *
 * Gas Station lets a developer sponsor their users' gas: a **policy** defines
 * which transactions are eligible (per-tx / per-day spend caps, daily op caps,
 * allowed contracts) on a given blockchain. Once a policy is active, Circle
 * Wallets transactions on that chain are sponsored automatically — there is no
 * per-transaction "sponsor" call to make; sponsorship is policy-driven.
 *
 * Circle exposes policy management primarily through the console; the REST
 * surface lives under the Web3 Services API. The exact base path can vary by
 * account/region, so it is injected as config (`policiesPath`) with a sensible
 * default rather than hardcoded as the single source of truth.
 *
 * Docs: https://developers.circle.com/wallets/gas-station/policy-management
 */
import { SettleKitError } from "@settlekit/common";
import { createFetchPaymasterHttp } from "./http.js";
import type { PaymasterHttp, PaymasterRequest, PaymasterResponse } from "./http.js";
import type { CreateGasPolicyInput, GasPolicy } from "./types.js";

/** Default Web3 Services path for Gas Station policies. */
export const DEFAULT_POLICIES_PATH = "/v1/w3s/gasStation/policies";
export const DEFAULT_GAS_STATION_BASE_URL = "https://api.circle.com";

export interface GasStationConfig {
  apiKey: string;
  baseUrl?: string;
  /** Override the policies REST path if your account exposes a different one. */
  policiesPath?: string;
  /** Inject a custom transport (defaults to a real fetch-based impl). */
  http?: PaymasterHttp;
  /** Inject a custom fetch (only used when `http` is not provided). */
  fetchImpl?: typeof fetch;
}

export interface GasStationClient {
  createPolicy(input: CreateGasPolicyInput): Promise<GasPolicy>;
  getPolicy(id: string): Promise<GasPolicy>;
  listPolicies(blockchain?: string): Promise<GasPolicy[]>;
  setPolicyStatus(id: string, active: boolean): Promise<GasPolicy>;
}

export function createGasStationClient(config: GasStationConfig): GasStationClient {
  if (!config.apiKey) {
    throw new SettleKitError({
      code: "validation_error",
      message: "createGasStationClient requires an apiKey",
    });
  }
  const baseUrl = config.baseUrl ?? DEFAULT_GAS_STATION_BASE_URL;
  const policiesPath = config.policiesPath ?? DEFAULT_POLICIES_PATH;
  const http =
    config.http ??
    createFetchPaymasterHttp({ apiKey: config.apiKey, baseUrl, fetchImpl: config.fetchImpl });

  async function send<T>(req: PaymasterRequest): Promise<T> {
    const res = await http.request(req);
    assertOk(res, req);
    return unwrapData<T>(res.body, req);
  }

  return {
    async createPolicy(input: CreateGasPolicyInput): Promise<GasPolicy> {
      requireNonEmpty(input.name, "createPolicy.name");
      requireNonEmpty(input.blockchain, "createPolicy.blockchain");
      const resource = await send<GasPolicyResource>({
        method: "POST",
        path: policiesPath,
        body: {
          idempotencyKey: input.idempotencyKey,
          name: input.name,
          blockchain: input.blockchain,
          limits: input.limits,
          contractAddresses: input.contractAddresses,
        },
      });
      return normalizePolicy(resource);
    },

    async getPolicy(id: string): Promise<GasPolicy> {
      requireNonEmpty(id, "getPolicy.id");
      const resource = await send<GasPolicyResource>({
        method: "GET",
        path: `${policiesPath}/${encodeURIComponent(id)}`,
      });
      return normalizePolicy(resource);
    },

    async listPolicies(blockchain?: string): Promise<GasPolicy[]> {
      const resources = await send<GasPolicyResource[]>({
        method: "GET",
        path: policiesPath,
        query: { blockchain },
      });
      return resources.map(normalizePolicy);
    },

    async setPolicyStatus(id: string, active: boolean): Promise<GasPolicy> {
      requireNonEmpty(id, "setPolicyStatus.id");
      const resource = await send<GasPolicyResource>({
        method: "PATCH",
        path: `${policiesPath}/${encodeURIComponent(id)}`,
        body: { status: active ? "active" : "inactive" },
      });
      return normalizePolicy(resource);
    },
  };
}

/** Raw Gas Station policy resource as returned by Circle (inside `data`). */
interface GasPolicyResource {
  id: string;
  name: string;
  blockchain: string;
  status?: string;
  limits?: {
    maxSpendPerTransaction?: string;
    maxSpendPerDay?: string;
    maxOperationsPerDay?: number;
  };
  contractAddresses?: string[];
  createDate?: string;
  updateDate?: string;
}

/** Circle's success envelope: `{ data: T }`. */
interface PaymasterEnvelope<T> {
  data: T;
}

interface PaymasterErrorBody {
  code?: number | string;
  message?: string;
}

function normalizePolicy(r: GasPolicyResource): GasPolicy {
  return {
    id: r.id,
    name: r.name,
    blockchain: r.blockchain,
    status: r.status === "inactive" ? "inactive" : "active",
    limits: r.limits,
    contractAddresses: r.contractAddresses as GasPolicy["contractAddresses"],
    createDate: r.createDate,
    updateDate: r.updateDate,
  };
}

function requireNonEmpty(value: string, op: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new SettleKitError({ code: "validation_error", message: `${op} is required` });
  }
}

function assertOk(res: PaymasterResponse, req: PaymasterRequest): void {
  if (res.status >= 200 && res.status < 300) return;
  const errorBody = (res.body ?? {}) as PaymasterErrorBody;
  const message =
    typeof errorBody.message === "string" && errorBody.message.length > 0
      ? errorBody.message
      : `Circle Gas Station ${req.method} ${req.path} failed with status ${res.status}`;
  throw new SettleKitError({
    code: "integration_error",
    message,
    httpStatus: 502,
    retryable: res.status >= 500 || res.status === 429,
    details: {
      status: res.status,
      request: { method: req.method, path: req.path },
      circleError: res.body,
    },
  });
}

function unwrapData<T>(body: unknown, req: PaymasterRequest): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as PaymasterEnvelope<T>).data;
  }
  throw new SettleKitError({
    code: "integration_error",
    message: `Circle Gas Station response for ${req.method} ${req.path} was missing the data envelope`,
    httpStatus: 502,
    details: { request: { method: req.method, path: req.path }, body },
  });
}
