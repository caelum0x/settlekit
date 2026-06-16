/**
 * Paymaster + Gas Station routes — gasless / pay-gas-in-USDC for checkout and
 * agents on Arc (USDC is the native gas token).
 *
 *   GET  /v1/paymaster/config           EntryPoint + Circle Paymaster addresses
 *   POST /v1/paymaster/permit-data      EIP-2612 permit typed-data to sign
 *   POST /v1/paymaster/paymaster-data   encode paymasterData from a permit sig
 *   POST /v1/gas-station/policies       create a sponsorship policy (cred-gated)
 *   GET  /v1/gas-station/policies       list sponsorship policies (cred-gated)
 *   GET  /v1/gas-station/policies/:id   get a sponsorship policy (cred-gated)
 *
 * The config/permit/paymaster-data endpoints are pure + permissionless (Circle
 * Paymaster is a permissionless ERC-4337 contract). Gas Station policy
 * management requires `GAS_STATION_API_KEY`; without it those endpoints return a
 * clear "not configured" error.
 */
import { Hono } from "hono";
import { z } from "zod";
import { validationError } from "@settlekit/common";
import { ARC_TESTNET } from "@settlekit/arc";
import {
  ENTRYPOINT_ADDRESS,
  resolvePaymasterAddress,
  buildPermitTypedData,
  encodePaymasterData,
  DEFAULT_MAX_GAS_USDC,
  MAX_UINT256,
  type PermitTypedData,
} from "@settlekit/paymaster";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address");
const uint = z.string().regex(/^\d+$/, "must be a base-unit integer string");
const version = z.enum(["0.7", "0.8"]).default("0.7");

const permitSchema = z.object({
  /** The smart account that owns the USDC. */
  owner: hexAddress,
  /** Max USDC the permit authorizes, in 6-decimal base units. */
  value: uint,
  /** Current EIP-2612 nonce of `owner` on the USDC token. */
  nonce: uint,
  /** EntryPoint version (selects the paymaster spender). Defaults to 0.7. */
  version,
  /** Override USDC token; defaults to Arc testnet USDC. */
  usdcAddress: hexAddress.optional(),
  /** Override chain id; defaults to Arc testnet. */
  chainId: z.number().int().positive().optional(),
  /** EIP-712 token name/version (USDC defaults). */
  tokenName: z.string().optional(),
  tokenVersion: z.string().optional(),
  /** Permit deadline (base-unit seconds / uint); defaults to no expiry. */
  deadline: uint.optional(),
});

const paymasterDataSchema = z.object({
  /** The customer's signed EIP-2612 permit. */
  permitSignature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  /** Max USDC the paymaster may spend on gas (base units); defaults to 1 USDC. */
  maxGasUsdc: uint.optional(),
  usdcAddress: hexAddress.optional(),
});

const policySchema = z.object({
  name: z.string().min(1),
  blockchain: z.string().min(1),
  limits: z
    .object({
      maxSpendPerTransaction: z.string().optional(),
      maxSpendPerDay: z.string().optional(),
      maxOperationsPerDay: z.number().int().positive().optional(),
    })
    .optional(),
  contractAddresses: z.array(hexAddress).optional(),
});

/** Stringify the bigint fields of permit typed-data so it is JSON-safe. */
function jsonSafePermit(td: PermitTypedData): unknown {
  return {
    ...td,
    message: {
      ...td.message,
      value: td.message.value.toString(),
      nonce: td.message.nonce.toString(),
      deadline: td.message.deadline.toString(),
    },
  };
}

export function paymasterRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/paymaster/config", async (c) => {
    const v = version.parse(c.req.query("version") ?? "0.7");
    return data(c, {
      version: v,
      chainId: ARC_TESTNET.chainId,
      entryPoint: ENTRYPOINT_ADDRESS[v],
      paymaster: resolvePaymasterAddress(ARC_TESTNET, v),
      usdc: ARC_TESTNET.tokens.USDC.address,
    });
  });

  app.post("/paymaster/permit-data", async (c) => {
    const body = await parseBody(c, permitSchema);
    const spender = resolvePaymasterAddress(ARC_TESTNET, body.version);
    const typedData = buildPermitTypedData({
      tokenName: body.tokenName ?? "USDC",
      tokenVersion: body.tokenVersion ?? "2",
      usdcAddress: (body.usdcAddress ?? ARC_TESTNET.tokens.USDC.address) as `0x${string}`,
      chainId: body.chainId ?? ARC_TESTNET.chainId,
      owner: body.owner as `0x${string}`,
      spender,
      value: BigInt(body.value),
      nonce: BigInt(body.nonce),
      deadline: body.deadline !== undefined ? BigInt(body.deadline) : MAX_UINT256,
    });
    return data(c, jsonSafePermit(typedData));
  });

  app.post("/paymaster/paymaster-data", async (c) => {
    const body = await parseBody(c, paymasterDataSchema);
    const paymasterData = encodePaymasterData({
      usdcAddress: (body.usdcAddress ?? ARC_TESTNET.tokens.USDC.address) as `0x${string}`,
      maxGasUsdc: body.maxGasUsdc !== undefined ? BigInt(body.maxGasUsdc) : DEFAULT_MAX_GAS_USDC,
      permitSignature: body.permitSignature as `0x${string}`,
    });
    return data(c, { paymasterData });
  });

  app.post("/gas-station/policies", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.gasStation) throw notConfigured();
    const body = await parseBody(c, policySchema);
    const policy = await ctx.gasStation.createPolicy({
      name: body.name,
      blockchain: body.blockchain,
      ...(body.limits ? { limits: body.limits } : {}),
      ...(body.contractAddresses
        ? { contractAddresses: body.contractAddresses as `0x${string}`[] }
        : {}),
    });
    return created(c, policy);
  });

  app.get("/gas-station/policies", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.gasStation) throw notConfigured();
    const blockchain = c.req.query("blockchain");
    return data(c, await ctx.gasStation.listPolicies(blockchain));
  });

  app.get("/gas-station/policies/:id", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.gasStation) throw notConfigured();
    return data(c, await ctx.gasStation.getPolicy(c.req.param("id")));
  });

  return app;
}

function notConfigured() {
  return validationError("gas station is not configured; set GAS_STATION_API_KEY");
}
