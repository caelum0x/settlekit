/**
 * Browser EVM wallet logic behind EvmPay: EIP-6963 discovery, the
 * switch-or-add chain dance (4902) and the exact transfer call.
 */
import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { getEvmChain, sessionMemo, viemChainFor } from "@settlekit/chains";

import {
  EIP6963_ANNOUNCE,
  EIP6963_REQUEST,
  ERC20_TRANSFER_ABI,
  TIP20_TRANSFER_WITH_MEMO_ABI,
  addAnnouncement,
  buildEip681TransferUri,
  buildAddChainParams,
  buildTransferCall,
  encodeTransferCall,
  isUserRejection,
  legacyInjectedWallet,
  parseAnnouncement,
  switchOrAddChain,
  toHexChainId,
  walletChainId,
  watchEip6963Wallets,
  type Eip1193Provider,
  type Eip6963ProviderDetail,
  type Hex,
} from "../lib/evm-wallet";

const ICON = "data:image/svg+xml;base64,PHN2Zy8+";
const provider = (): Eip1193Provider => ({ request: async () => null });
const detail = (uuid: string, name = "Rabby", icon = ICON) => ({ info: { uuid, name, icon, rdns: "io.rabby" }, provider: provider() });

describe("EIP-6963 discovery", () => {
  it("accepts well-formed announcements and drops malformed ones", () => {
    expect(parseAnnouncement(detail("u1"))?.info).toEqual({ uuid: "u1", name: "Rabby", icon: ICON, rdns: "io.rabby" });
    expect(parseAnnouncement(null)).toBeNull();
    expect(parseAnnouncement({ info: { uuid: "", name: "x" }, provider: provider() })).toBeNull();
    expect(parseAnnouncement({ info: { uuid: "u", name: "x" }, provider: {} })).toBeNull();
  });

  it("never renders a remote or script icon", () => {
    expect(parseAnnouncement(detail("u1", "X", "https://tracker.example/icon.png"))?.info.icon).toBe("");
    expect(parseAnnouncement(detail("u1", "X", "javascript:alert(1)"))?.info.icon).toBe("");
  });

  it("de-duplicates by uuid, latest announcement wins", () => {
    let list: Eip6963ProviderDetail[] = [];
    list = addAnnouncement(list, detail("a", "MetaMask"));
    list = addAnnouncement(list, detail("b", "Rabby"));
    list = addAnnouncement(list, detail("a", "MetaMask Flask"));
    list = addAnnouncement(list, { junk: true });
    expect(list.map((entry) => entry.info.name)).toEqual(["Rabby", "MetaMask Flask"]);
  });

  it("requests announcements and reports wallets as they arrive", () => {
    const target = new EventTarget();
    const requests: string[] = [];
    target.addEventListener(EIP6963_REQUEST, (event) => requests.push(event.type));
    const seen: string[][] = [];
    const stop = watchEip6963Wallets(target, (wallets) => seen.push(wallets.map((w) => w.info.name)));

    target.dispatchEvent(new CustomEvent(EIP6963_ANNOUNCE, { detail: detail("a", "MetaMask") }));
    target.dispatchEvent(new CustomEvent(EIP6963_ANNOUNCE, { detail: detail("b", "Rabby") }));
    stop();
    target.dispatchEvent(new CustomEvent(EIP6963_ANNOUNCE, { detail: detail("c", "Late") }));

    expect(requests).toEqual([EIP6963_REQUEST]);
    expect(seen).toEqual([["MetaMask"], ["MetaMask", "Rabby"]]);
  });

  it("offers window.ethereum only when it is a provider", () => {
    expect(legacyInjectedWallet(undefined)).toBeNull();
    expect(legacyInjectedWallet({})).toBeNull();
    expect(legacyInjectedWallet(provider())?.info.name).toBe("Browser wallet");
  });
});

describe("chain switching", () => {
  const tempo = getEvmChain("tempo", "mainnet")!;
  const params = buildAddChainParams({
    chainId: tempo.chainId,
    name: tempo.name,
    rpcUrl: tempo.defaultRpcUrl,
    nativeCurrency: viemChainFor(tempo).nativeCurrency,
    explorerTxBase: tempo.explorerTx(""),
  });

  it("builds EIP-3085 params from the registry", () => {
    expect(params).toEqual({
      chainId: "0x1079",
      chainName: "Tempo",
      nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
      rpcUrls: ["https://rpc.tempo.xyz"],
      blockExplorerUrls: ["https://explore.tempo.xyz"],
    });
    expect(toHexChainId(8453)).toBe("0x2105");
    expect(() => toHexChainId(0)).toThrow();
    const hyperTestnet = getEvmChain("hyperevm", "testnet")!;
    const noExplorer = buildAddChainParams({
      chainId: hyperTestnet.chainId,
      name: hyperTestnet.name,
      rpcUrl: hyperTestnet.defaultRpcUrl,
      nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
      explorerTxBase: hyperTestnet.explorerTx(""),
    });
    expect(noExplorer.blockExplorerUrls).toBeUndefined();
  });

  function recordingProvider(failSwitch: unknown[]): Eip1193Provider & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async request({ method }) {
        calls.push(method);
        if (method === "wallet_switchEthereumChain" && failSwitch.length > 0) throw failSwitch.shift();
        if (method === "eth_chainId") return "0x1079";
        return null;
      },
    };
  }

  it("switches directly when the wallet knows the chain", async () => {
    const wallet = recordingProvider([]);
    await switchOrAddChain(wallet, params);
    expect(wallet.calls).toEqual(["wallet_switchEthereumChain"]);
    expect(await walletChainId(wallet)).toBe(4217);
  });

  it("adds then switches on 4902 (also when nested by mobile wallets)", async () => {
    const direct = recordingProvider([{ code: 4902 }]);
    await switchOrAddChain(direct, params);
    expect(direct.calls).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);

    const nested = recordingProvider([{ code: -32603, data: { originalError: { code: 4902 } } }]);
    await switchOrAddChain(nested, params);
    expect(nested.calls).toContain("wallet_addEthereumChain");
  });

  it("surfaces a rejection instead of adding the chain", async () => {
    const wallet = recordingProvider([{ code: 4001, message: "User rejected" }]);
    const error = await switchOrAddChain(wallet, params).catch((err: unknown) => err);
    expect(isUserRejection(error)).toBe(true);
    expect(wallet.calls).toEqual(["wallet_switchEthereumChain"]);
  });
});

describe("transfer call", () => {
  const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
  const payTo = "0x3333333333333333333333333333333333333333" as Hex;

  it("encodes an exact ERC-20 transfer", () => {
    const call = buildTransferCall({ token, payTo, amountBase: "25000000", memo: null });
    const decoded = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: encodeTransferCall(call) });
    expect(decoded).toEqual({ functionName: "transfer", args: [payTo, 25_000_000n] });
  });

  it("encodes a TIP-20 memo transfer binding the session", () => {
    const memo = sessionMemo("cs_123");
    const call = buildTransferCall({ token, payTo, amountBase: "1", memo });
    const decoded = decodeFunctionData({ abi: TIP20_TRANSFER_WITH_MEMO_ABI, data: encodeTransferCall(call) });
    expect(decoded).toEqual({ functionName: "transferWithMemo", args: [payTo, 1n, memo] });
  });

  it("refuses non-integer or zero amounts and bad memos", () => {
    expect(() => buildTransferCall({ token, payTo, amountBase: "1.5", memo: null })).toThrow();
    expect(() => buildTransferCall({ token, payTo, amountBase: "0", memo: null })).toThrow();
    expect(() => buildTransferCall({ token, payTo, amountBase: "1", memo: "0x12" as Hex })).toThrow();
  });
});

describe("EIP-681 mobile request", () => {
  it("encodes chain, token, recipient and exact base units", () => {
    expect(
      buildEip681TransferUri({
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        chainId: 8453,
        payTo: "0x3333333333333333333333333333333333333333",
        amountBase: "25000000",
      }),
    ).toBe(
      "ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=0x3333333333333333333333333333333333333333&uint256=25000000",
    );
    expect(() =>
      buildEip681TransferUri({ token: "0x1" as Hex, chainId: 8453, payTo: "0x2" as Hex, amountBase: "0" }),
    ).toThrow();
  });
});
