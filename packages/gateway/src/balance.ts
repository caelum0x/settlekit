/**
 * On-chain unified-balance reads for Circle Gateway.
 *
 * Domain logic depends only on the {@link GatewayRpc} seam (a single
 * `readContract`-style call), so balance aggregation is unit-tested with an
 * in-memory double. A real viem-backed implementation is provided for
 * production.
 */

import { SettleKitError } from "@settlekit/common";
import { createPublicClient, http } from "viem";
import { GATEWAY_WALLET_ABI } from "./abi.js";
import type { Address, GatewayBalance } from "./types.js";

/** The four `GatewayWallet` balance getters, by name. */
export type BalanceGetter =
  | "totalBalance"
  | "availableBalance"
  | "withdrawingBalance"
  | "withdrawableBalance";

/** Narrow on-chain read seam: call a `GatewayWallet` balance getter. */
export interface GatewayRpc {
  /** Read one `uint256` balance getter for `(token, depositor)`. */
  readBalance(params: {
    gatewayWallet: Address;
    getter: BalanceGetter;
    token: Address;
    depositor: Address;
  }): Promise<bigint>;
}

/** Configuration for the real viem-backed {@link GatewayRpc}. */
export interface ViemGatewayRpcConfig {
  /** JSON-RPC HTTP endpoint for the chain hosting the GatewayWallet. */
  rpcUrl: string;
}

/** Create a real {@link GatewayRpc} backed by a viem public client. */
export function createViemGatewayRpc(config: ViemGatewayRpcConfig): GatewayRpc {
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  return {
    async readBalance(params): Promise<bigint> {
      const result = await client.readContract({
        address: params.gatewayWallet,
        abi: GATEWAY_WALLET_ABI,
        functionName: params.getter,
        args: [params.token, params.depositor],
      });
      if (typeof result !== "bigint") {
        throw new SettleKitError({
          code: "integration_error",
          message: `Gateway: ${params.getter} returned a non-numeric value`,
          details: { result: String(result) },
        });
      }
      return result;
    },
  };
}

/**
 * Read a depositor's full Gateway balance breakdown on a single chain
 * (available, withdrawing, withdrawable, and the total). The four getters are
 * read concurrently.
 */
export async function readGatewayBalance(
  rpc: GatewayRpc,
  params: { gatewayWallet: Address; token: Address; depositor: Address },
): Promise<GatewayBalance> {
  const [total, available, withdrawing, withdrawable] = await Promise.all([
    rpc.readBalance({ ...params, getter: "totalBalance" }),
    rpc.readBalance({ ...params, getter: "availableBalance" }),
    rpc.readBalance({ ...params, getter: "withdrawingBalance" }),
    rpc.readBalance({ ...params, getter: "withdrawableBalance" }),
  ]);
  return { total, available, withdrawing, withdrawable };
}

/** A depositor's `availableBalance` on one chain, used to aggregate a unified total. */
export interface ChainAvailable {
  /** CCTP domain of the chain, for labeling. */
  domain: number;
  /** Available balance on that chain, in USDC base units. */
  available: bigint;
}

/**
 * Pure aggregation: sum per-chain available balances into a single spendable
 * unified balance, in USDC base units. This is the on-chain analogue of the
 * Gateway API's unified balance and is fully deterministic.
 */
export function sumUnifiedAvailable(perChain: ChainAvailable[]): bigint {
  return perChain.reduce((acc, c) => acc + c.available, 0n);
}
