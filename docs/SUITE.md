# SettleKit App Suite

SettleKit is a commerce OS for developers selling software, APIs, and access in USDC on Arc + Circle. Beyond the core platform, the repo vendors and adopts a suite of Arc/Circle reference apps as first-class `@settlekit/*` apps — each builds, is SettleKit-branded, and is deploy-configured (`vercel.json`).

> Generated catalog. Each adopted app currently runs standalone (its own Supabase/Circle env); the **Integration roadmap** column lists where it duplicates a shared `@settlekit/*` package and could be rewired.

## Adopted Arc/Circle apps

### `apps/arc-commerce` — USDC Credits Checkout

**Purpose:** Next.js app to purchase platform credits with USDC on Arc testnet via Circle Developer-Controlled Wallets (with Supabase auth/persistence and Circle webhooks).

**Integration roadmap (rewire candidates):**

- apps/arc-commerce/lib/chains.ts (SupportedChainId incl. ARC_TESTNET=5042002, CHAIN_TO_CHAIN_NAME, CHAIN_IDS_TO_USDC_ADDRESSES, CHAIN_IDS_TO_TOKEN_MESSENGER/MESSAGE_TRANSMITTER, DESTINATION_DOMAINS) -> @settlekit/arc (Arc chain config) + @settlekit/cctp (CCTP V2 contract/domain registry); also @settlekit/arc-chains exists and likely overlaps the chain-id/name maps.
- apps/arc-commerce/lib/wagmi/config.ts and lib/wagmi/usdcAddresses.ts (hand-rolled arcTestnet wagmi chain def + per-chain USDC address table) -> @settlekit/arc (canonical Arc chain + RPC/explorer) and shared USDC address constants, removing the duplicated 0x36...0000 Arc USDC literal.
- apps/arc-commerce/app/api/circle/webhook/route.ts (the CCTP_APPROVAL -> depositForBurn -> Iris attestation poll -> receiveMessage mint state machine in updateAdminTransactionStatus) -> @settlekit/cctp (CCTP V2 burn/mint + attestation retrieval).
- apps/arc-commerce/lib/actions/admin-wallets.ts transferFromAdminWalletCCTP (approve + depositForBurn orchestration) -> @settlekit/cctp.
- apps/arc-commerce/lib/circle/developer-controlled-wallets-client.ts + app/api/wallet/route.ts + app/api/wallet-set/route.ts + app/api/destination-wallet/route.ts + lib/circle/initialize-admin-wallet.ts + lib/actions/admin-wallets.ts (createWalletSet/createWallets/createContractExecutionTransaction/getTransaction against Circle W3S dev-controlled wallets) -> @settlekit/circle-wallets.
- apps/arc-commerce/lib/actions/admin-wallets.ts getWalletBalance (direct GET /v1/w3s/wallets/{id}/balances) and the per-chain balance reads -> @settlekit/gateway (Circle Gateway unified balance) or @settlekit/circle-wallets balance helpers.
- apps/arc-commerce/app/api/circle/webhook/route.ts verifyCircleSignature/getCirclePublicKey (Circle webhook signature verification) -> @settlekit/circle (shared Circle client/webhook-verify utility) to align with the monorepo's canonical webhook-signing scheme.
- apps/arc-commerce/lib/circle/permit.ts (EIP-2612 permit typed-data builder + signPermit) -> @settlekit/circle-wallets or @settlekit/cctp permit helpers.

### `apps/arc-escrow` — Escrow Refund Protocol

**Purpose:** AI-validated USDC escrow on Arc testnet (Workflow Escrow Refund Protocol): contract creation/deposit, OpenAI-validated deliverable submission, then automated fund release or refund via Circle Developer-Controlled Wallets and the EIP-712 Refund Protocol smart contract.

**Integration roadmap (rewire candidates):**

- apps/arc-escrow/lib/utils/developer-controlled-wallets-client.ts (initiateDeveloperControlledWalletsClient + apiKey/entitySecret bootstrap) -> @settlekit/circle-wallets — replace the ad-hoc W3S dev-controlled wallet client with the shared package.
- apps/arc-escrow/app/api/wallet/route.ts, app/api/wallet-set/route.ts, app/api/wallet/balance/route.ts, app/api/wallet/transactions/route.ts, app/api/wallet/transactions/[id]/route.ts (wallet set creation, balance + transaction queries via circleDeveloperSdk) -> @settlekit/circle-wallets (wallet/balance/tx primitives), with treasury-style balance tracking via @settlekit/treasury.
- apps/arc-escrow/lib/utils/smart-contract-platform-client.ts + lib/constants.ts (REFUND_PROTOCOL_BYTECODE/ABI, SYSTEM_AGENT_ADDRESS, USDC_CONTRACT_ADDRESS, CIRCLE_BLOCKCHAIN=ARC-TESTNET) -> @settlekit/arc — centralize Arc chain config (USDC address, blockchain id) and on-chain verify in the shared Arc package instead of hardcoded constants.
- apps/arc-escrow/app/api/contracts/escrow/route.ts, escrow/deposit/route.ts, escrow/deposit/approve/route.ts, escrow/refund/route.ts and lib/utils/executeContract.ts (deploy Refund Protocol + ERC-20 approve/deposit/refund contract executions) -> @settlekit/arc (Arc on-chain execution/verify) + @settlekit/circle-wallets (contract execution signing).
- apps/arc-escrow/lib/utils/create-circle-ramp-session.ts + app/api/usdc/buy/route.ts + app/api/usdc/sell/route.ts (Circle Ramp QUOTE_SCREEN buy/sell USDC<->USD sessions) -> @settlekit/stablefx (Circle Mint FX / fiat on-off ramp).
- apps/arc-escrow/app/api/webhooks/circle/route.ts (hand-rolled crypto.createVerify SHA256 signature check + getCirclePublicKey fetch) -> shared Circle webhook verification utility (currently lives in @settlekit/circle-wallets / circle webhook signing per project MEMORY); reuse the canonical signing/verification scheme instead of a per-app implementation.

### `apps/arc-fintech` — Multi-Chain Treasury

**Purpose:** Next.js 15 multi-chain USDC treasury management app using Circle Developer Controlled Wallets, Circle Gateway (unified balance), and Bridge Kit (CCTP) for cross-chain bridging, with Supabase auth/realtime.

**Integration roadmap (rewire candidates):**

- lib/circle/gateway-sdk.ts (arcTestnet chain def + USDC_ADDRESSES + getUsdcBalance on-chain reads) -> @settlekit/arc (Arc chain config + on-chain verify) and @settlekit/arc-chains
- lib/circle/gateway-sdk.ts (BurnIntent EIP-712 typed data, submitBurnIntent, executeGatewayMint, signAndSubmitGatewayBurnIntent, transferUnifiedBalanceCircle, DOMAIN_IDS) -> @settlekit/cctp (CCTP V2 burn/mint) — currently hand-rolled against gateway-api-testnet.circle.com
- lib/circle/gateway-sdk.ts (fetchGatewayBalance, fetchGatewayInfo, GATEWAY_WALLET_ADDRESS/GATEWAY_MINTER_ADDRESS, /v1/balances + /v1/info calls) and lib/circle/gateway-sdk.ts deposit flow -> @settlekit/gateway (Circle Gateway unified balance)
- app/api/gateway/balance/route.ts and app/api/gateway/deposit/route.ts (Gateway balance fetch + custodial deposit/approve) -> @settlekit/gateway
- app/api/bridge/estimate/route.ts and app/api/bridge/rebalance/route.ts (BridgeKit + createCircleWalletsAdapter CCTP FAST/SLOW estimate + execute) -> @settlekit/cctp (and chain mapping could share @settlekit/arc-chains)
- lib/circle/developer-controlled-wallets-client.ts and lib/circle/create-gateway-eoa-wallets.ts (initiateDeveloperControlledWalletsClient, createWalletSet/createWallets EOA, getGatewayEOAWalletId) -> @settlekit/circle-wallets (W3S dev-controlled wallets)
- app/api/wallet/route.ts, app/api/wallet-set/route.ts, app/api/wallet/transfer/route.ts, app/api/wallet/create-gateway-signers/route.ts (wallet/wallet-set creation + transfers via Circle SDK) -> @settlekit/circle-wallets
- lib/compliance/utils.ts and app/api/compliance/screen + app/api/compliance/logs (Circle W3S compliance screening /v1/w3s/compliance/screening/addresses) -> @settlekit/treasury (treasury/compliance) if it exposes screening, otherwise candidate for a shared compliance helper

### `apps/arc-multichain-wallet` — Gateway USDC Wallet

**Purpose:** A Next.js sample wallet demonstrating unified cross-chain USDC balances, deposits, and transfers across Arc Testnet, Base Sepolia, and Avalanche Fuji using Circle Gateway and Circle Developer-Controlled Wallets.

**Integration roadmap (rewire candidates):**

- /Users/arhansubasi/settlekit/apps/arc-multichain-wallet/lib/circle/gateway-sdk.ts (arcTestnet chain definition, USDC_ADDRESSES, DOMAIN_IDS, getUsdcBalance, getChainConfig) -> @settlekit/arc (Arc chain config + on-chain USDC verify) — replaces the hand-rolled arcTestnet Chain object and per-chain USDC/domain maps.
- /Users/arhansubasi/settlekit/apps/arc-multichain-wallet/lib/circle/gateway-sdk.ts (fetchGatewayBalance, fetchGatewayInfo, GATEWAY_WALLET_ADDRESS/GATEWAY_MINTER_ADDRESS constants, /v1/balances and /v1/info calls) -> @settlekit/gateway (Circle Gateway unified balance) — replaces raw fetch calls to gateway-api-testnet.circle.com for balances and info.
- /Users/arhansubasi/settlekit/apps/arc-multichain-wallet/lib/circle/gateway-sdk.ts (burnIntentTypedData, BurnIntent/TransferSpec EIP-712 types, submitBurnIntent, transferGatewayBalanceWithEOA, transferUnifiedBalanceCircle, executeMintCircle, gatewayMint ABI, attestation polling) -> @settlekit/cctp (CCTP V2 burn/mint) — replaces the hand-rolled burn-intent construction, signing, /v1/transfer submission, attestation polling, and gatewayMint execution.
- /Users/arhansubasi/settlekit/apps/arc-multichain-wallet/lib/circle/sdk.ts and lib/circle/create-gateway-eoa-wallets.ts (initiateDeveloperControlledWalletsClient init, createWallets, getWallet, signTypedData, createContractExecutionTransaction, EOA/SCA wallet lifecycle) -> @settlekit/circle-wallets (W3S dev-controlled wallets) — replaces direct @circle-fin/developer-controlled-wallets SDK usage and EOA/SCA wallet provisioning.
- /Users/arhansubasi/settlekit/apps/arc-multichain-wallet/lib/circle/permit.ts (eip2612Permit, signPermit, eip2612Abi) -> @settlekit/circle-wallets or @settlekit/paymaster — EIP-2612 permit signing helper duplicates gasless-approval primitives; relevant if Circle Paymaster gas abstraction is wired in (see the TODO in lib/deposit.ts).
- /Users/arhansubasi/settlekit/apps/arc-multichain-wallet/lib/deposit.ts (handleDeposit mock with 'Integrate Circle Paymaster API for gas abstraction' TODO and gasPaidWithUSDC placeholder) -> @settlekit/paymaster — the stubbed gas-in-USDC deposit flow is exactly what the paymaster package provides.
- /Users/arhansubasi/settlekit/apps/arc-multichain-wallet/lib/circle/gateway-sdk.ts (initiateDepositFromCustodialWallet, withdrawFromCustodialWallet — approve+deposit and initiateWithdrawal+withdraw orchestration into the Gateway wallet contract) -> @settlekit/treasury — custodial deposit/withdraw treasury movements into the unified Gateway balance.

### `apps/arc-nanopayments` — USDC Nanopayments

**Purpose:** Gasless sub-cent USDC nanopayments on Arc: a LangChain buyer agent pays x402-protected seller endpoints via Circle Gateway batching, with a Next.js seller dashboard for monitoring payments and withdrawing earnings.

**Integration roadmap (rewire candidates):**

- /Users/arhansubasi/settlekit/apps/arc-nanopayments/lib/x402.ts -> @settlekit/x402 + @settlekit/gateway: hand-rolls withGateway() using BatchFacilitatorClient.verify/settle and manually builds x402 payment requirements (scheme/network/asset/payTo + GatewayWalletBatched extra). This is exactly the pay-per-call 402 wrapping that @settlekit/x402 provides, with Gateway settlement belonging to @settlekit/gateway.
- /Users/arhansubasi/settlekit/apps/arc-nanopayments/app/api/gateway/balance/route.ts -> @settlekit/gateway + @settlekit/arc: directly POSTs to Circle's gateway-api-testnet balances endpoint and reads on-chain ERC-20 balanceOf via a raw viem client. @settlekit/gateway covers Circle Gateway unified-balance queries; the hardcoded Arc constants (domain 26, RPC, USDC 0x3600...) belong in @settlekit/arc.
- /Users/arhansubasi/settlekit/apps/arc-nanopayments/app/api/gateway/withdraw/route.ts -> @settlekit/gateway + @settlekit/cctp: instantiates GatewayClient and calls getBalances()/withdraw() with cross-chain (CCTP) mint to other testnets. The Gateway balance/withdraw orchestration maps to @settlekit/gateway and the cross-chain burn/mint step maps to @settlekit/cctp (CCTP V2).
- /Users/arhansubasi/settlekit/apps/arc-nanopayments/lib/x402.ts (Arc constants ARC_TESTNET_NETWORK eip155:5042002, ARC_TESTNET_USDC 0x3600..., ARC_TESTNET_GATEWAY_WALLET) -> @settlekit/arc: duplicated Arc chain config + verifying-contract address that @settlekit/arc centralizes (Arc chain config + on-chain verify).
- /Users/arhansubasi/settlekit/apps/arc-nanopayments/agent.mts -> @settlekit/gateway + @settlekit/x402: the buyer agent re-implements Gateway deposit/balance checks (GatewayClient) and x402 pay-and-retry signing against paywalled endpoints, which @settlekit/gateway (balances/deposit) and @settlekit/x402 (client-side 402 payment) already provide.

### `apps/arc-p2p-payments` — P2P Payments

**Purpose:** Gasless peer-to-peer USDC payment app on Arc Network using Circle Modular Wallets with passkey (WebAuthn) security, Supabase auth/DB, and viem account-abstraction userOps.

**Integration roadmap (rewire candidates):**

- apps/arc-p2p-payments/components/web3-provider.tsx (arcTestnet defineChain block, RPC URL, USDC_ADDRESS 0x3600...0000, chain id 5042002, explorer) -> @settlekit/arc: replace the hand-rolled Arc chain config + native-USDC constants with the package's canonical Arc chain definition and on-chain verify helpers.
- apps/arc-p2p-payments/lib/utils/get-explorer-url.ts (hardcoded https://testnet.arcscan.app/address/) -> @settlekit/arc: explorer URL helper duplicates Arc network metadata that @settlekit/arc owns.
- apps/arc-p2p-payments/lib/utils/developer-controlled-wallets-client.ts + app/api/wallet-set/route.ts + app/api/setup-wallets/route.ts + app/auth/callback/route.ts (initiateDeveloperControlledWalletsClient, createWalletSet, wallet creation, passkey/SCA wallet provisioning) -> @settlekit/circle-wallets: dev-controlled / W3S wallet creation and wallet-set management duplicate the W3S wallet package.
- apps/arc-p2p-payments/app/api/wallet/balance/route.ts + app/api/wallet/transactions/route.ts + app/api/wallet/transactions/[id]/route.ts (raw axios/fetch calls to https://api.circle.com/v1/w3s/buidl/wallets|transfers with bearer CIRCLE_API_KEY, manual USDC tokenBalances parsing) -> @settlekit/circle-wallets (and possibly @settlekit/gateway for unified balance): replace the bespoke Circle REST balance/transfer queries with the package SDK.
- apps/arc-p2p-payments/components/web3-provider.tsx sendUSDC()/sendTransaction() (encodeTransfer + bundlerClient.sendUserOperation with paymaster:true, estimateFeesPerGas gas floor) -> @settlekit/paymaster: the gasless userOp + paymaster sponsorship logic duplicates the paymaster package; gas-fee estimation/floor handling could be centralized there.
- apps/arc-p2p-payments/app/api/webhooks/circle/route.ts (crypto-based Circle webhook signature verification + transfers/modular-wallet notification handling) -> @settlekit/circle-wallets or a shared webhook-signing util: the webhook signature verification and Circle notification parsing duplicate canonical Circle webhook handling.
- apps/arc-p2p-payments cross-chain top-up / settlement flows (not yet present but P2P USDC settlement implied) -> @settlekit/cctp (CCTP V2 burn/mint) and @settlekit/treasury: if multi-chain funding/settlement is added, route it through these packages instead of bespoke transfers.

### `apps/arc-prediction-markets` — Prediction Markets

**Purpose:** Prediction market platform on Arc Testnet where users create/trade Yes/No outcome tokens via a built-in constant-product AMM, resolved trustlessly by UMA's Optimistic Oracle V2 (full UMA infra bootstrapped on-chain), with dual MetaMask + Circle passkey wallet support.

**Integration roadmap (rewire candidates):**

- /Users/arhansubasi/settlekit/apps/arc-prediction-markets/lib/chain.ts -> @settlekit/arc: hand-rolled `arcTestnet` viem Chain (id 5042002, USDC native gas, ArcScan explorer, fee overrides) duplicates @settlekit/arc's exported `ARC_TESTNET` / `getArcChain` / `ArcChain`. Replace local Chain literal with the package export.
- /Users/arhansubasi/settlekit/apps/arc-prediction-markets/lib/wagmi.ts -> @settlekit/arc: re-exports/uses the local `arcTestnet` chain and builds an http transport against a duplicated RPC URL constant; could consume the canonical chain + RPC from @settlekit/arc (createArcClient / createViemArcRpc).
- /Users/arhansubasi/settlekit/apps/arc-prediction-markets/app/api/create-market/route.ts -> @settlekit/arc: server-side `createPublicClient`/`createWalletClient` wired to a hardcoded `https://rpc.testnet.arc.network` and the local `arcTestnet` chain; could use @settlekit/arc's `createArcClient`/`createViemArcRpc` for a single source of truth on chain + RPC config. The on-chain tx-receipt polling could also use @settlekit/arc's typed receipt helpers (ArcTransactionReceipt).
- /Users/arhansubasi/settlekit/apps/arc-prediction-markets/lib/circle.ts -> @settlekit/circle-wallets: passkey/modular W3S transport setup (toPasskeyTransport/toModularTransport), client-key/url config gating (isCircleConfigured), and Circle public/bundler client construction duplicate dev-controlled wallet plumbing that @settlekit/circle-wallets provides.
- /Users/arhansubasi/settlekit/apps/arc-prediction-markets/contexts/WalletContext.tsx -> @settlekit/circle-wallets: WebAuthn credential register/login (toWebAuthnCredential), toCircleSmartAccount, smart-account bundler client and session restore logic duplicate @settlekit/circle-wallets' W3S smart-account lifecycle helpers.
- /Users/arhansubasi/settlekit/apps/arc-prediction-markets/lib/circle.ts (estimateUserOpFees) + contexts/WalletContext.tsx (createBundlerClient with paymaster:true) -> @settlekit/paymaster: the pimlico_getUserOperationGasPrice fee estimation, baseFee fallback math, and gas-sponsored UserOperation paymaster wiring duplicate gas-sponsorship/paymaster responsibilities owned by @settlekit/paymaster.
- /Users/arhansubasi/settlekit/apps/arc-prediction-markets/hooks/useContractWrite.ts -> @settlekit/circle-wallets + @settlekit/paymaster: the unified write path that branches between wagmi writeContract and Circle bundler sendUserOperation (paymaster:true) re-implements the abstraction that a shared circle-wallets/paymaster client would expose.

### `apps/arc-stablecoin-fx` — USDC ↔ EURC FX

**Purpose:** A Next.js app for onchain USDC ↔ EURC stablecoin FX swaps on Arc, using Circle App Kit Swap SDK + Circle Developer-Controlled Wallets, with Supabase auth, per-user wallet provisioning, live balances, and trade history.

**Integration roadmap (rewire candidates):**

- /Users/arhansubasi/settlekit/apps/arc-stablecoin-fx/src/lib/circle/client.ts (initiateDeveloperControlledWalletsClient + entity-secret handling) -> @settlekit/circle-wallets (client.ts / dcw-sdk.ts / envelope.ts already wrap the W3S dev-controlled wallets client + entity secret encryption)
- /Users/arhansubasi/settlekit/apps/arc-stablecoin-fx/src/lib/circle/wallets.ts (createWalletSet/createWallets EOA provisioning + getWalletTokenBalance) -> @settlekit/circle-wallets (user-wallets.ts for wallet/wallet-set creation and balance reads)
- /Users/arhansubasi/settlekit/apps/arc-stablecoin-fx/scripts/generate-wallet.ts (registerEntitySecretCiphertext + provisioning) -> @settlekit/circle-wallets (envelope.ts / dcw-sdk.ts entity-secret registration)
- /Users/arhansubasi/settlekit/apps/arc-stablecoin-fx/src/lib/appkit/swap.ts (App Kit AppKit + createCircleWalletsAdapter estimateSwap/swap with customFee) -> @settlekit/stablefx (fx.ts / rfq.ts / client.ts Circle Mint FX quoting + execution) and @settlekit/circle-wallets (adapter wiring)
- /Users/arhansubasi/settlekit/apps/arc-stablecoin-fx/src/lib/fx.ts (explorerTxUrl / ARC_EXPLORER_TX_URL / Arc chain + token constants) -> @settlekit/arc (chains.ts / arc-client.ts Arc chain config, explorer URLs, USDC ABI) and @settlekit/arc-chains
- /Users/arhansubasi/settlekit/apps/arc-stablecoin-fx/src/app/api/webhooks/circle/route.ts (hand-rolled Circle webhook receiver + bearer-token auth + inbound settlement handling) -> @settlekit/webhooks (canonical signature verification + handler scaffolding instead of a shared-bearer secret)
- /Users/arhansubasi/settlekit/apps/arc-stablecoin-fx/src/lib/config.ts APP_FEE_BPS / APP_FEE_RECIPIENT platform-fee model -> @settlekit/treasury (platform take-rate / fee-recipient management aligned with the monorepo platform-take-rate revenue model)

### `apps/circle-cctp-crosschain-transfer` — Crosschain USDC Transfer

**Purpose:** Next.js demo that transfers USDC across chains via Circle's Cross-Chain Transfer Protocol (CCTP V2), walking the full approve -> burn -> attest -> mint flow on EVM and Solana testnets using injected browser wallets.

**Integration roadmap (rewire candidates):**

- /Users/arhansubasi/settlekit/apps/circle-cctp-crosschain-transfer/src/hooks/use-cross-chain-transfer.ts (EVM burn/mint via depositForBurn + receiveMessage, IRIS attestation polling, fast-transfer fee calc) -> @settlekit/cctp (CCTP V2 burn/mint primitives + attestation handling)
- /Users/arhansubasi/settlekit/apps/circle-cctp-crosschain-transfer/src/lib/solana-utils.ts (Solana CCTP PDA derivation, depositForBurn/receiveMessage Anchor wiring, nonce decoding) -> @settlekit/cctp (CCTP V2 Solana path) 
- /Users/arhansubasi/settlekit/apps/circle-cctp-crosschain-transfer/src/lib/chains.ts (Arc Testnet entry: chainId 5042002, usdcAddress 0x3600..., tokenMessenger, messageTransmitter, destinationDomain 26 + viem arcTestnet chain) -> @settlekit/arc (Arc chain config + on-chain verify)
- /Users/arhansubasi/settlekit/apps/circle-cctp-crosschain-transfer/src/lib/chains.ts (full CHAIN_CONFIGS record: per-chain USDC/tokenMessenger/messageTransmitter addresses + CCTP destinationDomain map) -> @settlekit/cctp (canonical CCTP V2 contract + domain registry, deduplicate hardcoded addresses)
- /Users/arhansubasi/settlekit/apps/circle-cctp-crosschain-transfer/src/hooks/use-cross-chain-transfer.ts getEvmBalance/getSolanaBalance (per-chain USDC balance reads) -> @settlekit/gateway (Circle Gateway unified cross-chain USDC balance, replacing per-chain balanceOf polling)
- /Users/arhansubasi/settlekit/apps/circle-cctp-crosschain-transfer/src/lib/browser-wallets.ts (injected EIP-6963 EVM + Phantom Solana wallet discovery/connect/sign) -> @settlekit/circle-wallets (W3S dev-controlled wallets) as an alternative signing backend for server/programmatic flows

### `apps/circle-bridge-kit-transfer` — Crosschain Bridge

**Purpose:** A Vite/React sample app that transfers USDC across EVM and Solana testnets using Circle's Bridge Kit (CCTP burn-and-mint) with a connect-wallet experience.

**Integration roadmap (rewire candidates):**

- src/hooks/useBridge.ts (BridgeKit().bridge/retry/estimate burn-mint flow) -> @settlekit/cctp (CCTP V2 burn/mint) — the core cross-chain transfer could be rewired to SettleKit's own CCTP package instead of @circle-fin/bridge-kit
- src/hooks/useUsdcBalance.ts (usdc.balanceOf via adapter.prepareAction) -> @settlekit/gateway (Circle Gateway unified balance) — per-chain USDC balance reads could be replaced with Gateway's unified balance, or with @settlekit/cctp chain helpers
- src/lib/mapChains.ts + src/lib/wagmiConfig.ts (BridgeKit getSupportedChains -> Wagmi Chain mapping, incl. Arc_Testnet default in App.tsx) -> @settlekit/arc and @settlekit/arc-chains (Arc chain config + on-chain verify) — chain metadata/Arc config could come from the SettleKit Arc packages rather than being derived dynamically from Bridge Kit
- src/hooks/useEvmAdapter.ts + src/hooks/useSolanaWallet.ts (manual viem/solana adapter construction from injected providers) -> @settlekit/circle-wallets (W3S dev-controlled wallets) — could offer a dev-controlled-wallet signing path alongside the user-wallet adapters
- src/App.tsx estimate/gasFees handling (kit.estimate fee breakdown) -> @settlekit/treasury and @settlekit/paymaster — fee estimation and gas sponsorship could be sourced from SettleKit treasury/paymaster instead of Bridge Kit's estimate
- FX/Mint flows are not present in this app, so @settlekit/stablefx (Circle Mint FX) and @settlekit/x402 (pay-per-call) have no direct duplication here — listed only as adjacent packages, no concrete mapping

## Core SettleKit apps

`api` (REST backend), `worker` (jobs), `dashboard` (merchant), `checkout` (hosted USDC checkout), `admin`, `portal` (buyer), `marketplace`, `agent-console`, `creator-dashboard`, `stream-meter`, `web` (marketing), `docs`, `cli`.

## Adopted contracts & references

- `apps/chainmail`, `apps/recibo`, `apps/refund-protocol`, `apps/circle-cctp-fulfiller-repayment` — Foundry/script projects (escrow, receipts, refund protocol, CCTP repayment prototype).
- `apps/skills` — Circle agent-skills reference plugins.
