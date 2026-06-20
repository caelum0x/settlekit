/**
 * `createViemAppKitSdk` — a viem-backed {@link AppKitSdk} implementing ONLY the
 * SEND capability (a USDC ERC-20 transfer on Arc). It needs `viem` alone; no
 * `@circle-fin/*` SDK.
 *
 * PROMINENT CAVEAT: bridge / swap / unified-balance deposit & spend are NOT
 * supported here — they throw {@link notSupported}. Use `@circle-fin/app-kit`
 * for those flows. See {@link UNSUPPORTED_MESSAGE_SUFFIX}.
 *
 * `A` is the opaque signing adapter the consumer threads through
 * `SdkSendParams.from.adapter`. This backend resolves the actual signer from its
 * own {@link ViemAppKitConfig} (injected wallet or private key), so `A` is not
 * used to sign — it stays generic to satisfy the port and keep the consumer's
 * adapter type flowing.
 */

import type {
  AppKitSdk,
  SdkBridgeParams,
  SdkDepositParams,
  SdkEstimate,
  SdkResult,
  SdkSendParams,
  SdkSpendParams,
  SdkSwapParams,
  UnifiedBalanceSdk,
} from "@settlekit/app-kit";
import type { ChainDescriptor } from "@settlekit/arc-chains";
import { explorerTxUrl } from "@settlekit/arc-chains";
import { SettleKitError } from "@settlekit/common";
import { formatUnits } from "viem";
import type { Chain } from "viem";
import { ERC20_TRANSFER_ABI } from "./abi.js";
import type { ViemAppKitConfig } from "./account.js";
import { resolveWallet } from "./account.js";
import { toViemChain } from "./chain.js";
import { checksumAddress, toBaseUnits } from "./encode.js";
import {
  resolveChain,
  resolveDecimals,
  resolveToken,
  resolveUsdcAddress,
} from "./resolve.js";
import { notSupported } from "./unsupported.js";

/** Wrap a viem/transport runtime error as a retryable integration error. */
function wrapTransportError(operation: string, cause: unknown): SettleKitError {
  if (SettleKitError.is(cause)) return cause;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new SettleKitError({
    code: "integration_error",
    message: `viem ${operation} failed: ${detail}`,
    retryable: true,
    cause,
  });
}

/** Pre-flight resolution shared by `send` and `estimateSend` (no network). */
interface SendPlan {
  descriptor: ChainDescriptor;
  chain: Chain;
  usdc: ReturnType<typeof checksumAddress>;
  to: ReturnType<typeof checksumAddress>;
  baseUnits: bigint;
}

function planSend<A>(
  config: ViemAppKitConfig,
  params: SdkSendParams<A>,
): SendPlan {
  const token = resolveToken(params.token);
  const descriptor = resolveChain(params.from.chain);
  const usdc = resolveUsdcAddress(
    params.from.chain,
    token,
    config.tokenAddressOverrides,
  );
  const decimals = resolveDecimals(token);
  const baseUnits = toBaseUnits(params.amount, decimals);
  const to = checksumAddress(params.to);

  const chain = toViemChain(
    {
      ...descriptor,
      ...(config.chainId !== undefined ? { chainId: config.chainId } : {}),
      ...(config.rpcUrl !== undefined ? { rpcUrl: config.rpcUrl } : {}),
      ...(config.explorerUrl !== undefined
        ? { explorerUrl: config.explorerUrl }
        : {}),
    },
    config.nativeCurrency,
  );

  return { descriptor, chain, usdc, to, baseUnits };
}

/** A viem-backed App Kit SDK. */
class ViemAppKitSdk<A> implements AppKitSdk<A> {
  readonly unifiedBalance: UnifiedBalanceSdk<A>;

  constructor(private readonly config: ViemAppKitConfig) {
    this.unifiedBalance = {
      deposit: async (_params: SdkDepositParams<A>): Promise<SdkResult> =>
        notSupported("unifiedBalance.deposit"),
      spend: async (_params: SdkSpendParams<A>): Promise<SdkResult> =>
        notSupported("unifiedBalance.spend"),
    };
  }

  async send(params: SdkSendParams<A>): Promise<SdkResult> {
    const plan = planSend(this.config, params);
    const explorerBase: ChainDescriptor = {
      ...plan.descriptor,
      ...(this.config.explorerUrl !== undefined
        ? { explorerUrl: this.config.explorerUrl }
        : {}),
    };
    const { walletClient, publicClient, account } = resolveWallet(
      this.config,
      plan.chain,
      plan.descriptor.rpcUrl,
    );

    try {
      const hash = await walletClient.writeContract({
        address: plan.usdc,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [plan.to, plan.baseUnits],
        account,
        chain: plan.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return {
        name: "transfer",
        state: receipt.status === "success" ? "success" : "failed",
        txHash: hash,
        explorerUrl: explorerTxUrl(explorerBase, hash),
      };
    } catch (cause) {
      throw wrapTransportError("transfer", cause);
    }
  }

  async estimateSend(params: SdkSendParams<A>): Promise<SdkEstimate> {
    const plan = planSend(this.config, params);
    const { publicClient, account } = resolveWallet(
      this.config,
      plan.chain,
      plan.descriptor.rpcUrl,
    );

    try {
      const gas = await publicClient.estimateContractGas({
        address: plan.usdc,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [plan.to, plan.baseUnits],
        account,
      });
      const gasPrice = await publicClient.getGasPrice();
      const fee = gas * gasPrice;
      const feeDecimals = this.config.nativeCurrency?.decimals ?? 18;
      return {
        gas: gas.toString(),
        gasPrice: gasPrice.toString(),
        fee: formatUnits(fee, feeDecimals),
      };
    } catch (cause) {
      throw wrapTransportError("estimateContractGas", cause);
    }
  }

  async bridge(_params: SdkBridgeParams<A>): Promise<SdkResult> {
    return notSupported("bridge");
  }

  async swap(_params: SdkSwapParams<A>): Promise<SdkResult> {
    return notSupported("swap");
  }
}

/**
 * Build a viem-backed {@link AppKitSdk} for the SEND capability on Arc.
 *
 * @param config injected wallet OR private-key source (+ optional overrides for
 *   the unpublished Arc chainId / USDC address). Keys come from config/env,
 *   never hardcoded.
 */
export function createViemAppKitSdk<A = unknown>(
  config: ViemAppKitConfig,
): AppKitSdk<A> {
  return new ViemAppKitSdk<A>(config);
}
