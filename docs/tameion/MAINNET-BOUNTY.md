# Arc Mainnet Bounty: SettleKit runbook

Source: https://arc-oss.thecanteenapp.com/#mainnet-bounty (read 2026-10-07).

## What the bounty actually says

- Prize: about 20 teams get **$500 each**. The page does not mention $10k.
- Eligibility:
  1. Have a valid Arc Open Source Showcase entry **on or before Sep 30, 2026**.
  2. Deploy the project to Arc mainnet.
  3. Post on X that you deployed, share your experience, and tag @thecanteenapp.
  4. Run `arc-canteen submit-showcase` again. Put the mainnet contract addresses and the X post link clearly in the entry.
- How winners are picked: open-source momentum (GitHub activity), real mainnet users (not the founder with a second wallet, reported through `arc-canteen update-traction`), and growth.
- Risk: no `~/.arc-canteen/` directory exists on this Mac, so no CLI showcase entry was made from here. If the Sep 30 entry was not made through the Google form either, SettleKit is not eligible for this bounty. Check before spending time on it.

## Arc mainnet facts (verified 2026-10-07)

| Item | Value | Source |
| --- | --- | --- |
| Chain id | 5042 (`cast chain-id` against the RPC returned 5042) | https://docs.arc.io/arc/references/connect-to-arc |
| RPC | `https://rpc.mainnet.arc.io`. Alternatives: `rpc.blockdaemon.mainnet.arc.io`, `rpc.drpc.mainnet.arc.io`, `rpc.quicknode.mainnet.arc.io` | same |
| Explorer | https://explorer.arc.io (Blockscout). Verify API: `https://explorer.arc.io/api/`. The testnet docs use `--verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/` | https://docs.arc.io/integrate/deploy-on-arc.md |
| Sourcify | Chain 5042 "Arc Mainnet" is `supported: true` | https://sourcify.dev/server/chains |
| USDC | `0x3600000000000000000000000000000000000000`. This is the same address as on testnet. On-chain it reports symbol `USDC` and 6 decimals; native gas uses 18 decimals | https://docs.arc.io/arc/references/contract-addresses.md |
| CCTP V2 (domain 26) | MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | same |
| Gas | USDC is the gas token. The mempool rejects a `maxFeePerGas` below 20 gwei. `cast gas-price` returned about 20.0 gwei | https://docs.arc.io/arc/references/evm-differences.md |

## What gets deployed

`contracts/script/DeployArcMainnet.s.sol` deploys these two contracts:

- **OperatorVault**: the Tameion operator guard rails.
- **SettleKitEscrow**: the buyer/seller/arbiter USDC escrow.

**SettleKitCctpHook is excluded on purpose.** In CCTP V2, `MessageTransmitterV2.receiveMessage` calls `handleReceive*Message` on the message *recipient*. For a burn, that recipient is TokenMessengerV2, never the `mintRecipient`; see `circlefin/evm-cctp-contracts` `src/v2/MessageTransmitterV2.sol`. As a result:

- The hook's handlers would never run on mainnet.
- The hook has no way to withdraw, so any USDC minted to it would be stuck.
- If a handler ever did run, it would forward the contract's whole balance, not just the amount for that order.

The tests pass only because they call the handler directly from a mock transmitter. The fix is to rework the hook into Circle's `CCTPHookWrapper` pattern: call `receiveMessage` itself, settle only the balance delta, and require `destinationCaller` to be the wrapper. That is follow-up work and not needed for this bounty.

## Safety review (mainnet)

**OperatorVault**
- No backdoors, mocks or faucet functions. Every function is gated:
  - The owner can set caps, allowlist, operator, ownership and yield adapter, withdraw, approve/reject, and pause.
  - The operator can allocate, pay and run yield moves.
  - Anyone can call `expire`, but only on escalations older than 72h, and it can only return funds to their bucket.
- It uses a reentrancy lock and checks-effects-interactions ordering. TAX is never spendable by the operator. A non-zero address is enforced for token, owner and operator.
- Two things to know:
  - An owner `approve` bypasses the daily cap (the owner accepted this design). The day's spend counter still goes up.
  - The yield adapter is trusted by the owner, so set it only to an audited USYC adapter. The default is none, which gives `YieldDisabled`.
- If the operator key is lost, the owner can recover unallocated funds by calling `setOperator` with their own address and then `allocate`.
- Mainnet cap defaults in the wrapper: 100 USDC per transaction, 250 USDC per day, escalation above 50 USDC. Change them later with `setCaps`.
- The operator defaults to the deployer. Point it at the agent's wallet with `setOperator` once the agent runs on mainnet.

**SettleKitEscrow**
- No admin role at all. The token is fixed in the constructor. State is final before every transfer, and token return values are checked.
- Escrow ids are chosen by the caller. A front-runner could take a pending id, which makes the buyer's transaction revert with `AlreadyExists`. That is griefing only; no funds are lost.
- The arbiter is not restricted, so a buyer could name themselves arbiter. Sellers must check `arbiter` on-chain before delivering. That is a documented trust assumption, not a bug.
- On Arc, a blocklisted party makes the transfers to them revert. The arbiter can then use the other path, release or refund.

No contract source was changed. `forge test` passes: 48/48.

## The one owner command

1. Prerequisite, done once: import your own key into an encrypted Foundry keystore. Never put the key in a file.

   ```bash
   cast wallet import settlekit-deployer --interactive
   ```

2. Fund that address with about 1 USDC on Arc mainnet. The expected cost is about 0.06 USDC.

3. Deploy and verify:

   ```bash
   ~/products/settlekit-main/contracts/script/deploy-arc-mainnet.sh --account settlekit-deployer
   ```

   `--ledger` also works.

The script:
- checks that the chain id is 5042;
- checks the USDC at `0x3600…0000` (symbol `USDC`, 6 decimals);
- simulates, then prints the gas, the cost in USDC and your balance;
- refuses if the balance is below 2x the estimate;
- asks you to type `deploy`;
- broadcasts;
- verifies on Sourcify and on the Blockscout explorer (`explorer.arc.io/api/`);
- writes `contracts/deployments/arc-mainnet.json`.

Commit that JSON file afterwards.

Optional environment variables: `OPERATOR_VAULT_OPERATOR=0x…` (the agent's wallet) and `OPERATOR_VAULT_OWNER=0x…`. Both default to the deployer.

### Gas estimate

These numbers come from a simulation against the live mainnet RPC on 2026-10-07, then a real broadcast to a local anvil fork of mainnet.

| Contract | Gas used | Cost at 20 gwei |
| --- | --- | --- |
| OperatorVault | 2,350,074 | 0.047 USDC |
| SettleKitEscrow | 607,001 | 0.012 USDC |
| **Total** | **2,957,075** | **≈0.059 USDC** |

Forge's padded worst case is 3,844,197 gas at a 40 gwei max fee, which is 0.154 USDC. Verification is free.

Tested so far:
- `SIMULATE_ONLY=1 DEPLOYER_ADDRESS=0x… contracts/script/deploy-arc-mainnet.sh` against mainnet. This is a dry run; nothing was signed.
- The full flow against `anvil --fork-url https://rpc.mainnet.arc.io`, with an anvil test key and `SKIP_VERIFY=1`. Both contracts deployed, and `token()` and `perTxCap()` read back correctly.

Not tested: the verification step against the real explorers. That needs the real deployment.

## After deploying: X post draft

Replace the placeholders in angle brackets. The post makes no traction claims.

> SettleKit is live on Arc mainnet
>
> Open-source USDC commerce for software sellers. On Arc we just deployed:
> • OperatorVault: on-chain guard rails for an AI business operator (bucketed treasury, per-tx and daily caps, owner approval above a threshold, every decision hash-anchored)
> • SettleKitEscrow: buyer/seller/arbiter USDC escrow
>
> Vault: https://explorer.arc.io/address/<VAULT>
> Escrow: https://explorer.arc.io/address/<ESCROW>
> Source verified · MIT · https://github.com/caelum0x/settlekit
>
> Deploying was smooth: USDC as gas meant one token for everything, and the whole deploy cost about $0.06.
>
> @thecanteenapp

Note: the post tags only @thecanteenapp. Confirm the official Arc handle before tagging it.

## arc-canteen CLI

The CLI is not installed on this Mac. Repo: https://github.com/the-canteen-dev/ARC-cli. Install and log in:

```bash
uv tool install arc-canteen          # uv is at ~/.local/bin/uv; it is a small Python tool
arc-canteen login                    # GitHub sign-in; it also asks for your Discord handle
printf 'chain: mainnet\nevent_name: tameion\n' > ~/.arc-canteen/settings.yaml   # tag the events as mainnet
```

Both commands are **interactive only**. Neither takes flags; you answer prompts.

**`arc-canteen submit-showcase`** asks for:
1. Main repo: `https://github.com/caelum0x/settlekit`
2. Live site: `https://settlekit-web.onrender.com`
3. Standalone infra repo (optional): `-`, or a split-out repo if one is made
4. The pitch, as multiline text that ends with an empty line. Suggested text:

   ```
   SettleKit is open-source USDC commerce infrastructure with reusable Arc primitives:
   - OperatorVault (Arc mainnet <VAULT>): policy-bounded treasury for an AI operator. Four buckets (operating/tax/yield/refund), per-tx + daily caps, payee allowlist, owner escalation with 72h expiry, pause switch, DecisionAnchored event for every action so an off-chain decision log can be verified on-chain.
   - SettleKitEscrow (Arc mainnet <ESCROW>): buyer/seller/arbiter USDC escrow with disputes.
   - TypeScript packages: @settlekit/operator (agent runtime + Circle DCW signer), @settlekit/arc / arc-chains, x402 facilitator, checkout links.
   Compared to circlefin/arc-commerce and arc-p2p-payments, we add agent-operated treasury with enforced on-chain policy, escrow, and a multichain hosted checkout that settles in USDC.
   Mainnet contracts (verified): <VAULT>, <ESCROW>. X post: <X_POST_URL>
   ```
5. Confirm that the live site stays live (`y`) and that the repo stays open (`y`).

**`arc-canteen update-traction`** asks for one multiline answer: "How many users have expressed interest… Who is using it currently?" Report only real numbers. Founder test wallets do not count as users, according to the bounty rules. Template:

```
Mainnet: <N> payments from <M> distinct non-founder wallets since <date> (vault <VAULT>). Testnet: <N> checkout payments on the live demo. GitHub: <stars> stars. Interested: <names/companies, only if they agreed to be named>.
```
