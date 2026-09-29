/**
 * Record golden vectors + deployment facts from live public RPCs into
 * test/fixtures/deployments.json. Run: node scripts/record-fixtures.mjs
 * (after `tsc -b`). Read-only: eth_getCode / eth_call only.
 */
import { writeFileSync } from "node:fs";
import { createPublicClient, http, keccak256 } from "viem";
import {
  COMMERCE_PAYMENTS_V1_1,
  PERMIT2_ADDRESS,
  SPEND_PERMISSION_MANAGER,
  authCaptureEscrowAbi,
  permit2Abi,
  spendPermissionManagerAbi,
} from "../dist/index.js";

const RPCS = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://mainnet.base.org",
  84532: "https://sepolia.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
  4663: "https://rpc.mainnet.chain.robinhood.com",
  999: "https://rpc.hyperliquid.xyz/evm",
  4217: "https://rpc.tempo.xyz",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  421614: "https://sepolia-rollup.arbitrum.io/rpc",
  46630: "https://rpc.testnet.chain.robinhood.com",
  998: "https://rpc.hyperliquid-testnet.xyz/evm",
  42431: "https://rpc.moderato.tempo.xyz",
};

export const SAMPLE_PAYMENT_INFO = {
  operator: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  payer: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  receiver: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  maxAmount: 25000000n,
  preApprovalExpiry: 1900000000,
  authorizationExpiry: 1900604800,
  refundExpiry: 1907776000,
  minFeeBps: 0,
  maxFeeBps: 250,
  feeReceiver: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  salt: 123456789012345678901234567890n,
};

export const SAMPLE_SPEND_PERMISSION = {
  account: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  spender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  allowance: 9990000n,
  period: 2592000,
  start: 1900000000,
  end: 1931104000,
  salt: 42n,
  extraData: "0x",
};

const client = (chainId) => createPublicClient({ transport: http(RPCS[chainId]) });

async function code(chainId, address) {
  const bytecode = (await client(chainId).getCode({ address })) ?? "0x";
  return { bytes: (bytecode.length - 2) / 2, keccak256: bytecode === "0x" ? null : keccak256(bytecode) };
}

const out = { recordedAt: new Date().toISOString(), commercePayments: {}, spendPermissionManager: {}, permit2: {}, goldens: {} };
for (const chainId of [8453, 84532]) {
  out.commercePayments[chainId] = {};
  for (const [name, address] of Object.entries(COMMERCE_PAYMENTS_V1_1)) out.commercePayments[chainId][name] = { address, ...(await code(chainId, address)) };
  const escrow = { address: COMMERCE_PAYMENTS_V1_1.authCaptureEscrow, abi: authCaptureEscrowAbi };
  out.goldens[chainId] = {
    paymentInfoTypehash: await client(chainId).readContract({ ...escrow, functionName: "PAYMENT_INFO_TYPEHASH" }),
    paymentInfoHash: await client(chainId).readContract({ ...escrow, functionName: "getHash", args: [SAMPLE_PAYMENT_INFO] }),
    spendPermissionHash: await client(chainId).readContract({
      address: SPEND_PERMISSION_MANAGER, abi: spendPermissionManagerAbi, functionName: "getHash", args: [SAMPLE_SPEND_PERMISSION],
    }),
    permit2DomainSeparator: await client(chainId).readContract({ address: PERMIT2_ADDRESS, abi: permit2Abi, functionName: "DOMAIN_SEPARATOR" }),
  };
}
for (const chainId of Object.keys(RPCS).map(Number)) {
  out.spendPermissionManager[chainId] = (await code(chainId, SPEND_PERMISSION_MANAGER)).bytes;
  out.permit2[chainId] = (await code(chainId, PERMIT2_ADDRESS)).bytes;
}
out.goldens[1] = {
  spendPermissionHash: await client(1).readContract({
    address: SPEND_PERMISSION_MANAGER, abi: spendPermissionManagerAbi, functionName: "getHash", args: [SAMPLE_SPEND_PERMISSION],
  }),
};
const json = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
out.samples = { paymentInfo: json(SAMPLE_PAYMENT_INFO), spendPermission: json(SAMPLE_SPEND_PERMISSION) };
writeFileSync(new URL("../test/fixtures/deployments.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out.goldens, null, 2));
