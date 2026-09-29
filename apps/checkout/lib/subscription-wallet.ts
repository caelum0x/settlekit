/**
 * Browser wallet steps for subscribing (client-safe, no React):
 *   - EVM: send the prerequisite calls (e.g. the one-time ERC-20 approve to
 *     Permit2) and wait for them, then eth_signTypedData_v4 the grant;
 *     revoking runs the returned calls (Permit2 approve(token, spender, 0, 0)).
 *   - Solana: the server builds the SPL approve / revoke transaction; the
 *     wallet signs and sends it and we return its base58 signature.
 */
import type { Eip1193Provider, Hex } from "./evm-wallet";
import type { SolanaChain, StandardWallet, StandardWalletAccount } from "./solana-wallets";

export interface WalletCall {
  to: string;
  data: string;
  chainId: number;
  description: string;
}

export interface TypedDataJson {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

const DOMAIN_FIELDS: readonly { name: string; type: string }[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
];

const RECEIPT_POLL_MS = 2_500;
const RECEIPT_TIMEOUT_MS = 180_000;

/** eth_signTypedData_v4 payload: EIP712Domain derived from the domain's fields. */
export function typedDataV4Payload(typed: TypedDataJson): string {
  const domainType = DOMAIN_FIELDS.filter((field) => typed.domain[field.name] !== undefined);
  return JSON.stringify({ ...typed, types: { EIP712Domain: domainType, ...typed.types } });
}

export async function signTypedDataV4(provider: Eip1193Provider, account: Hex, typed: TypedDataJson): Promise<Hex> {
  const signature = await provider.request({ method: "eth_signTypedData_v4", params: [account, typedDataV4Payload(typed)] });
  if (typeof signature !== "string" || !signature.startsWith("0x")) throw new Error("The wallet did not return a signature.");
  return signature as Hex;
}

async function waitForReceipt(provider: Eip1193Provider, hash: string): Promise<void> {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error(`Transaction ${hash} reverted.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }
  throw new Error("The wallet transaction is taking too long to confirm. Try again once it lands.");
}

/** Send each call from `account` and wait until it is mined. Returns the hashes. */
export async function sendCallsAndWait(
  provider: Eip1193Provider,
  account: Hex,
  calls: readonly WalletCall[],
  onStep?: (call: WalletCall) => void,
): Promise<string[]> {
  const hashes: string[] = [];
  for (const call of calls) {
    onStep?.(call);
    const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: call.to, data: call.data }] });
    if (typeof hash !== "string") throw new Error("The wallet did not send the transaction.");
    await waitForReceipt(provider, hash);
    hashes.push(hash);
  }
  return hashes;
}

// --- Solana ----------------------------------------------------------------------

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function toBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits: number[] = [];
  for (const byte of bytes.slice(zeros)) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += (digits[i] as number) << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => BASE58[d]).join("");
}

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardWalletAccount[] }>;
}

interface SignAndSendFeature {
  signAndSendTransaction(
    ...inputs: ReadonlyArray<{ account: StandardWalletAccount; transaction: Uint8Array; chain: SolanaChain }>
  ): Promise<ReadonlyArray<{ signature: Uint8Array }>>;
}

function feature<T>(wallet: StandardWallet, name: string): T | undefined {
  return (wallet.features as Readonly<Record<string, unknown>>)[name] as T | undefined;
}

export async function connectSolanaAccount(wallet: StandardWallet, chain: SolanaChain): Promise<StandardWalletAccount> {
  const connect = feature<ConnectFeature>(wallet, "standard:connect");
  if (!connect) throw new Error(`${wallet.name} cannot connect.`);
  const { accounts } = await connect.connect();
  const account = accounts.find((a) => a.chains.includes(chain)) ?? accounts[0];
  if (!account) throw new Error(`${wallet.name} did not share an account.`);
  return account;
}

/** Sign + send a server-built base64 transaction; returns the base58 signature. */
export async function signAndSendBase64(
  wallet: StandardWallet,
  account: StandardWalletAccount,
  chain: SolanaChain,
  base64: string,
): Promise<string> {
  const signAndSend = feature<SignAndSendFeature>(wallet, "solana:signAndSendTransaction");
  if (!signAndSend) throw new Error(`${wallet.name} cannot send Solana transactions.`);
  const transaction = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const [result] = await signAndSend.signAndSendTransaction({ account, transaction, chain });
  if (!result) throw new Error("The wallet did not send the transaction.");
  return toBase58(result.signature);
}
