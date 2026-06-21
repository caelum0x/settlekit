# CCTP Fulfiller Repayment Demo

This sample shows a payout-first, settlement-later flow. A selected fulfiller pays the recipient on Ethereum Sepolia first, and CCTP later settles repayment from platform treasury on Arc Testnet.

It is a simplified, intent-like demo focused on fulfiller selection and CCTP repayment, not a full intent network or solver system. The demo uses one operator wallet across Sepolia and Arc Testnet.

Example scenario:

- a platform keeps treasury on Arc Testnet and wants to pay a contractor on Ethereum Sepolia
- the platform selects a fulfiller using simple local logic
- the selected fulfiller fronts the contractor payout on Sepolia
- later, CCTP settles into a repayment contract on Sepolia
- the repayment contract reimburses the selected fulfiller

## Prerequisites

- Node.js 22+
- Foundry
- A funded operator wallet for Ethereum Sepolia and Arc Testnet
  - Native gas tokens on both chains
  - Testnet USDC on Arc Testnet for the operator
- Funded fulfiller wallets on Ethereum Sepolia
  - Testnet USDC on Ethereum Sepolia for the fulfiller wallets
- A deployed `IntentRepaymentEscrow` contract on Ethereum Sepolia

For convenience, this repo currently uses a demo repayment contract deployed on Sepolia at [0x65b1210b4ee0e56f03184b454b3bd035e8c6bdf0](https://sepolia.etherscan.io/address/0x65b1210b4ee0e56f03184b454b3bd035e8c6bdf0). You can use that address to run the sample as-is, or deploy your own repayment contract and set `REPAYMENT_CONTRACT_ADDRESS` to your deployment instead. The demo contract is intentionally minimal and only exists to make the flow easy to inspect.

## Getting Started

1. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```
2. Fill the required values in `.env`:
   ```bash
   OPERATOR_PRIVATE_KEY=0x...
   FULFILLER_ALPHA_PRIVATE_KEY=0x...
   FULFILLER_BETA_PRIVATE_KEY=0x...
   FULFILLER_GAMMA_PRIVATE_KEY=0x...
   REPAYMENT_CONTRACT_ADDRESS=0x...
   ```
   The sample uses a checked-in default recipient address. You can override it from the frontend form or with `npm run intent -- --recipient 0x...`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the contract test:
   ```bash
   forge test
   ```
5. Start the demo server:
   ```bash
   npm run serve
   ```
6. Either use the frontend at `http://localhost:3001` or run the CLI flow:
   ```bash
   npm run intent
   npm run fulfill
   npm run status
   npm run settle
   npm run status
   ```

## Scripts

- `npm run intent`: create a local intent record
- `npm run fulfill`: choose a fulfiller from three mock profiles, front the payout on Ethereum Sepolia, and register repayment there
- `npm run settle`: run the CCTP repayment leg end to end by submitting the burn, waiting for attestation, completing the destination mint, and repaying the selected fulfiller
- `npm run status`: print local demo state

Supporting commands:

- `npm run typecheck`: run TypeScript type-checking
- `npm run test:contract`: run the repayment contract test
- `npm run build:contract`: build the Solidity contract with Foundry

## How It Works

- The platform creates a payout intent and selects a fulfiller.
- The selected fulfiller fronts the payout on Ethereum Sepolia.
- The platform registers repayment and starts a CCTP burn from Arc Testnet.
- Once attestation is available, the destination mint lands in the repayment contract.
- The repayment contract releases funds to the selected fulfiller.

## Selection Inputs

This sample does not implement a full solver network or bidding system. It uses a simple local selection rule to keep the repayment flow easy to inspect.

The demo keeps the intent object small enough that changing one field can produce a different fulfiller selection:

```json
{
  "intentId": "0x...",
  "recipient": "0x...",
  "amountUsdc": "5",
  "priority": "fast",
  "maxFeeBps": 20
}
```

In practice, the selector mainly uses:

- `amountUsdc`
- `priority`
- `maxFeeBps`

Those fields are enough to produce visibly different outcomes across the three mock fulfillers:

- `alpha`: cheaper, slower, handles larger amounts
- `beta`: faster, more expensive
- `gamma`: cheapest for small payouts

## Flow

```text
+-----------+      selects fulfiller      +--------------------+   fronts payout    +------------+
| Platform  |---------------------------->| Selected Fulfiller |------------------->| Contractor |
+-----------+                             +--------------------+                    +------------+
      |                                              ^
      |                                              | repays fulfiller after mint
      |                                              |
      | starts CCTP repayment            +----------------------+
      |                                  |  Repayment Contract  |
      |                                  +----------------------+
      |                                              ^
      |                                              | mint lands here
      v                                              |                            
+------------------------------------------------------------------------------------------------+
|                                   CCTP settlement rail                                         |
|                    source burn -> attestation available -> destination mint                    |
+------------------------------------------------------------------------------------------------+
```

## Actor Mapping

- **Platform**: Owns the selection logic and starts the CCTP repayment flow
- **Selected Fulfiller**: Fronts the payout before final settlement
- **Recipient**: Receives the destination-side payout on Ethereum Sepolia
- **Repayment Contract**: Receives the destination-side CCTP mint and releases repayment to the selected fulfiller
- **CCTP settlement rail**: Handles the later crosschain settlement leg from Arc to Sepolia

## File Highlights

- `contracts/IntentRepaymentEscrow.sol`: repayment contract that records expected reimbursement and releases funds after mint
- `test/IntentRepaymentEscrow.t.sol`: Foundry test for the repayment contract
- `scripts/create-intent.ts`: creates the local payout intent record
- `scripts/fulfill-intent.ts`: selects a fulfiller, fronts the payout, and registers repayment
- `scripts/start-settlement.ts`: runs the CCTP repayment leg end to end
- `scripts/print-status.ts`: prints the local intent record and transaction hashes
- `src/lib/cctp.ts`: CCTP burn, attestation, fee quote, and mint helpers
- `src/lib/repayment.ts`: repayment contract and fulfiller-transfer helpers
- `src/lib/flow-logic.ts`: fulfiller selection and CCTP helper logic
- `src/lib/fulfillers.ts`: mock fulfiller profiles
- `src/lib/runtime.ts`: local demo-state persistence

## Usage Notes

- The sample uses one operator wallet across Ethereum Sepolia and Arc Testnet.
- The fulfiller wallets need Sepolia gas and Sepolia USDC to front payouts.
- The destination mint goes to the repayment contract, not to the recipient.
- The local intent record is an app-level correlation object, not a canonical CCTP message nonce.
- The local intent record is also used to resume interrupted `fulfill` and `settle` runs after transient failures.
- Public testnet defaults such as USDC addresses, Iris URL, and selection thresholds are checked into `src/config/env.ts`.

### How to See Different Fulfillers

The selection logic uses the intent fields to choose among the three mock fulfillers.

Examples:

- `priority = fast` tends to favor `beta`
- `priority = cheap` can favor `gamma` for smaller payouts such as `3 USDC`
- larger payout amounts such as `5 USDC` can exclude `gamma` and favor `alpha`

To try different outcomes, change the values in `src/config/env.ts`, use the frontend form, or pass CLI flags to `npm run intent`.

## Scope Note

The fulfiller-selection logic is intentionally lightweight. CCTP is the real crosschain settlement mechanism in the demo; the intent-processing layer is simplified so the repayment flow stays clear.

## Security & Usage Model

This sample application:

- assumes testnet usage only
- uses a trusted operator model
- uses local demo state for the intent record
- does not implement open solver competition
- does not implement production pricing or dispute logic
- is not intended for production use without modification

## License

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
