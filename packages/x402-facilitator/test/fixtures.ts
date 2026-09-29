/**
 * Signed x402 fixtures + a fake relayer chain for facilitator tests.
 *
 * Payloads are produced by the REAL x402-foundation client scheme
 * (`@x402/evm/exact/client`) signing with fixed test keys, so signature
 * verification runs real ECDSA recovery. Only chain I/O is faked: contract
 * code, simulation, transaction submission and the receipt's Transfer log.
 */
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  getAddress,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmClientScheme } from "@x402/evm/exact/client";
import { requirementsExtraFor, type FacilitatorAsset } from "../src/assets.js";
import type { GasOracle } from "../src/gas-guard.js";

// Well-known local development keys (anvil accounts 1 and 2). Never funded on mainnet.
export const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
export const payer = privateKeyToAccount(PAYER_KEY);
export const other = privateKeyToAccount(OTHER_KEY);

export const MERCHANT = getAddress("0x1111111111111111111111111111111111111111");
export const OTHER_MERCHANT = getAddress("0x2222222222222222222222222222222222222222");
export const RELAYER = getAddress("0x3333333333333333333333333333333333333333");
export const TX_HASH = `0x${"ab".repeat(32)}` as Hex;

/** x402 v2 requirements for `asset` paying `atomic` base units to `payTo`. */
export function requirementsFor(
  asset: FacilitatorAsset,
  atomic: string,
  payTo: string = MERCHANT,
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: asset.caip2,
    asset: asset.address,
    amount: atomic,
    payTo,
    maxTimeoutSeconds: 300,
    extra: requirementsExtraFor(asset),
    ...overrides,
  };
}

/** Sign a payment for `requirements` with the real x402 client scheme. */
export async function signPayment(
  requirements: PaymentRequirements,
  account = payer,
): Promise<PaymentPayload> {
  const client = new ExactEvmClientScheme(account);
  const result = await client.createPaymentPayload(2, requirements);
  return {
    x402Version: 2,
    accepted: requirements,
    payload: result.payload,
    resource: { url: "https://api.settlekit.test/v1/x402/research", description: "test", mimeType: "application/json" },
  };
}

/** Rewrite the authorization's `from` (the signature stays the signer's). */
export function withFrom(payment: PaymentPayload, from: string): PaymentPayload {
  const auth = payment.payload.authorization as Record<string, unknown>;
  return { ...payment, payload: { ...payment.payload, authorization: { ...auth, from } } };
}

export interface FakeChain {
  signer: FacilitatorEvmSigner;
  writes: Array<{ functionName: string; args: readonly unknown[] }>;
}

export interface FakeChainOptions {
  asset: FacilitatorAsset;
  /** Make the pre-settle simulation revert. */
  simulateReverts?: boolean;
  /** Make the transaction submission throw (nothing broadcast). */
  submitThrows?: boolean;
}

function transferLog(asset: Hex, from: Hex, to: Hex, value: bigint): Log {
  return {
    address: asset,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  };
}

/** A fake relayer chain: asset has code, payers are EOAs, transfers succeed. */
export function fakeChain(options: FakeChainOptions): FakeChain {
  const writes: FakeChain["writes"] = [];
  let lastTransfer: { from: Hex; to: Hex; value: bigint } | undefined;
  const huge = 10n ** 30n;
  const signer: FacilitatorEvmSigner = {
    getAddresses: () => [RELAYER],
    async readContract(args) {
      if (args.functionName === "transferWithAuthorization" && options.simulateReverts) {
        throw new Error("execution reverted: FiatTokenV2: invalid signature");
      }
      if (args.functionName === "allowance" || args.functionName === "balanceOf") return huge;
      return undefined;
    },
    async verifyTypedData() {
      return false;
    },
    async writeContract(args) {
      if (options.submitThrows) throw new Error("nonce too low");
      writes.push({ functionName: args.functionName, args: args.args });
      if (args.functionName === "transferWithAuthorization") {
        const [from, to, value] = args.args as [Hex, Hex, bigint];
        lastTransfer = { from, to, value: BigInt(value) };
      } else {
        // x402 Permit2 proxy settle(permit, owner, witness, signature)
        const [permit, owner, witness] = args.args as [
          { permitted: { amount: bigint } },
          Hex,
          { to: Hex },
        ];
        lastTransfer = { from: owner, to: witness.to, value: BigInt(permit.permitted.amount) };
      }
      return TX_HASH;
    },
    async sendTransaction() {
      return TX_HASH;
    },
    async waitForTransactionReceipt() {
      const logs = lastTransfer
        ? [transferLog(options.asset.address, lastTransfer.from, lastTransfer.to, lastTransfer.value)]
        : [];
      return { status: "success", logs };
    },
    async getCode({ address }) {
      return getAddress(address) === getAddress(options.asset.address) ? "0x6080604052" : "0x";
    },
  };
  return { signer, writes };
}

export interface FakeGas extends GasOracle {
  price: bigint;
  balance: bigint;
}

export function fakeGas(price = 1_000_000_000n, balance = 10n ** 20n): FakeGas {
  const state = { price, balance };
  return {
    get price() {
      return state.price;
    },
    set price(value: bigint) {
      state.price = value;
    },
    get balance() {
      return state.balance;
    },
    set balance(value: bigint) {
      state.balance = value;
    },
    gasPrice: async () => state.price,
    relayerBalance: async () => state.balance,
  };
}
