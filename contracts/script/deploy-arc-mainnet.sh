#!/usr/bin/env bash
# Deploy + verify SettleKit's Arc contracts (OperatorVault, SettleKitEscrow) on
# Arc MAINNET (chain id 5042). One command, run from anywhere:
#
#   contracts/script/deploy-arc-mainnet.sh --account <foundry-keystore-name>
#   contracts/script/deploy-arc-mainnet.sh --ledger
#
# The signer flags are passed straight to cast/forge. Never put a private key
# in a file; import it once with `cast wallet import <name> --interactive`.
#
# Steps: check tools -> check RPC chain id is 5042 -> check the USDC contract at
# 0x3600..00 (symbol USDC, 6 decimals) -> simulate and print gas + cost in USDC
# -> check the deployer balance -> ask you to type "deploy" -> broadcast ->
# verify on Sourcify and Blockscout -> write contracts/deployments/arc-mainnet.json
#
# Optional env:
#   OPERATOR_VAULT_OWNER      default: deployer address (approves escalations, sets policy)
#   OPERATOR_VAULT_OPERATOR   default: deployer address (the agent's wallet; change later
#                             with setOperator)
#   OPERATOR_PER_TX_CAP       default 100000000  (100 USDC, 6 dp)
#   OPERATOR_DAILY_CAP        default 250000000  (250 USDC)
#   OPERATOR_ESCALATE_ABOVE   default 50000000   (50 USDC)
#   ARC_RPC_URL               default https://rpc.mainnet.arc.io
#   ARC_BLOCKSCOUT_API        default https://explorer.arc.io/api/
#   DEPLOYER_ADDRESS          skip the `cast wallet address` lookup
#   SIMULATE_ONLY=1           stop after the simulation (no signer needed)
#   SKIP_VERIFY=1             skip source verification (used for local anvil tests)
set -euo pipefail

readonly CHAIN_ID=5042
readonly USDC=0x3600000000000000000000000000000000000000
readonly SCRIPT=script/DeployArcMainnet.s.sol:DeployArcMainnet
readonly RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
readonly BLOCKSCOUT_API="${ARC_BLOCKSCOUT_API:-https://explorer.arc.io/api/}"
readonly EXPLORER="https://explorer.arc.io"

cd "$(dirname "$0")/.."
SIGNER=("$@")

die() { printf 'error: %s\n' "$1" >&2; exit 1; }
say() { printf '\n== %s\n' "$1"; }

command -v forge >/dev/null || die "forge not found (install Foundry or Arc Foundry)"
command -v cast >/dev/null || die "cast not found"
command -v jq >/dev/null || die "jq not found (brew install jq)"

if [[ "${SIMULATE_ONLY:-0}" != "1" && ${#SIGNER[@]} -eq 0 ]]; then
  die "pass a signer: --account <keystore-name> or --ledger (or set SIMULATE_ONLY=1)"
fi

say "Network"
chain=$(cast chain-id --rpc-url "$RPC")
[[ "$chain" == "$CHAIN_ID" ]] || die "RPC $RPC reports chain id $chain, expected $CHAIN_ID (Arc mainnet)"
echo "chain id $chain via $RPC"

say "USDC at $USDC"
symbol=$(cast call "$USDC" "symbol()(string)" --rpc-url "$RPC")
decimals=$(cast call "$USDC" "decimals()(uint8)" --rpc-url "$RPC")
[[ "$symbol" == '"USDC"' && "$decimals" == "6" ]] || die "unexpected token at $USDC: symbol=$symbol decimals=$decimals"
echo "symbol $symbol, decimals $decimals"

say "Deployer"
if [[ -n "${DEPLOYER_ADDRESS:-}" ]]; then
  deployer="$DEPLOYER_ADDRESS"
elif [[ ${#SIGNER[@]} -gt 0 ]]; then
  deployer=$(cast wallet address "${SIGNER[@]}")
else
  die "SIMULATE_ONLY needs DEPLOYER_ADDRESS"
fi
deployer=$(cast to-check-sum-address "$deployer")
echo "$deployer"

export OPERATOR_VAULT_OWNER="${OPERATOR_VAULT_OWNER:-$deployer}"
export OPERATOR_VAULT_OPERATOR="${OPERATOR_VAULT_OPERATOR:-$deployer}"
export OPERATOR_PER_TX_CAP="${OPERATOR_PER_TX_CAP:-100000000}"
export OPERATOR_DAILY_CAP="${OPERATOR_DAILY_CAP:-250000000}"
export OPERATOR_ESCALATE_ABOVE="${OPERATOR_ESCALATE_ABOVE:-50000000}"
echo "vault owner    $OPERATOR_VAULT_OWNER"
echo "vault operator $OPERATOR_VAULT_OPERATOR"
echo "caps (6 dp)    perTx=$OPERATOR_PER_TX_CAP daily=$OPERATOR_DAILY_CAP escalateAbove=$OPERATOR_ESCALATE_ABOVE"

say "Build"
build_out=$(forge build --skip test 2>&1) || { echo "$build_out"; die "forge build failed"; }
echo ok

say "Simulation (nothing is sent)"
sim=$(forge script "$SCRIPT" --rpc-url "$RPC" --sender "$deployer" 2>&1) || { echo "$sim"; die "simulation failed"; }
gas=$(printf '%s\n' "$sim" | sed -n 's/.*Estimated total gas used for script: *\([0-9]*\).*/\1/p' | tail -1)
[[ -n "$gas" ]] || { echo "$sim"; die "could not read the gas estimate"; }
gas_price=$(cast gas-price --rpc-url "$RPC")
# Arc's mempool floor is 20 gwei; budget 2x the current price for headroom.
budget_wei=$(( gas * gas_price * 2 ))
cost=$(cast from-wei $(( gas * gas_price )))
budget=$(cast from-wei "$budget_wei")
echo "gas units        $gas"
echo "gas price        $gas_price wei ($(cast from-wei "$gas_price" gwei) gwei)"
echo "expected cost    $cost USDC (USDC is Arc's gas token)"
echo "budget (2x)      $budget USDC"

balance=$(cast balance "$deployer" --rpc-url "$RPC")
echo "deployer balance $(cast from-wei "$balance") USDC"

if [[ "${SIMULATE_ONLY:-0}" == "1" ]]; then
  echo; echo "SIMULATE_ONLY=1: stopping before broadcast."; exit 0
fi
# Compare as decimal strings: an 18-dp balance overflows bash's 64-bit integers.
gte() { (( ${#1} != ${#2} )) && { (( ${#1} > ${#2} )); return; }; [[ "$1" > "$2" || "$1" == "$2" ]]; }
gte "$balance" "$budget_wei" || die "fund $deployer with at least $budget USDC on Arc mainnet first"

say "Confirm"
printf 'Deploy OperatorVault + SettleKitEscrow to Arc MAINNET from %s? Type "deploy": ' "$deployer"
read -r answer
[[ "$answer" == "deploy" ]] || die "cancelled"

say "Broadcast"
forge script "$SCRIPT" --rpc-url "$RPC" --sender "$deployer" --broadcast --slow "${SIGNER[@]}"

run="broadcast/DeployArcMainnet.s.sol/$CHAIN_ID/run-latest.json"
[[ -f "$run" ]] || die "missing $run"
addr_of() { jq -r --arg n "$1" '[.transactions[] | select(.transactionType=="CREATE" and .contractName==$n)][-1].contractAddress' "$run"; }
hash_of() { jq -r --arg n "$1" '[.transactions[] | select(.transactionType=="CREATE" and .contractName==$n)][-1].hash' "$run"; }
vault=$(cast to-check-sum-address "$(addr_of OperatorVault)")
escrow=$(cast to-check-sum-address "$(addr_of SettleKitEscrow)")
vault_tx=$(hash_of OperatorVault)
escrow_tx=$(hash_of SettleKitEscrow)
echo "OperatorVault   $vault  ($EXPLORER/address/$vault)"
echo "SettleKitEscrow $escrow  ($EXPLORER/address/$escrow)"

vault_args=$(cast abi-encode "constructor(address,address,address,uint256,uint256,uint256)" \
  "$USDC" "$OPERATOR_VAULT_OWNER" "$OPERATOR_VAULT_OPERATOR" \
  "$OPERATOR_PER_TX_CAP" "$OPERATOR_DAILY_CAP" "$OPERATOR_ESCALATE_ABOVE")
escrow_args=$(cast abi-encode "constructor(address)" "$USDC")

mkdir -p deployments
jq -n --arg vault "$vault" --arg escrow "$escrow" --arg vtx "$vault_tx" --arg etx "$escrow_tx" \
  --arg deployer "$deployer" --arg owner "$OPERATOR_VAULT_OWNER" --arg operator "$OPERATOR_VAULT_OPERATOR" \
  --arg per "$OPERATOR_PER_TX_CAP" --arg day "$OPERATOR_DAILY_CAP" --arg esc "$OPERATOR_ESCALATE_ABOVE" \
  --arg usdc "$USDC" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
    network: "arc-mainnet", chainId: 5042, explorer: "https://explorer.arc.io", deployedAt: $at,
    deployer: $deployer, usdc: $usdc,
    contracts: {
      OperatorVault: { address: $vault, tx: $vtx, owner: $owner, operator: $operator,
                       perTxCap: $per, dailyCap: $day, escalateAbove: $esc },
      SettleKitEscrow: { address: $escrow, tx: $etx }
    }
  }' > deployments/arc-mainnet.json
echo "wrote contracts/deployments/arc-mainnet.json"

if [[ "${SKIP_VERIFY:-0}" == "1" ]]; then
  echo "SKIP_VERIFY=1: skipping verification."; exit 0
fi

say "Verify"
verify() { # name path args
  local addr=$1 id=$2 args=$3 ok=0
  forge verify-contract "$addr" "$id" --chain "$CHAIN_ID" --constructor-args "$args" \
    --verifier sourcify --watch && ok=1 || echo "Sourcify verification failed for $id"
  forge verify-contract "$addr" "$id" --chain "$CHAIN_ID" --constructor-args "$args" \
    --verifier blockscout --verifier-url "$BLOCKSCOUT_API" --watch && ok=1 \
    || echo "Blockscout verification failed for $id (Sourcify-verified sources are also shown by Blockscout)"
  [[ $ok == 1 ]] || echo "RETRY: forge verify-contract $addr $id --chain $CHAIN_ID --constructor-args $args --verifier sourcify"
}
verify "$vault" src/OperatorVault.sol:OperatorVault "$vault_args"
verify "$escrow" src/SettleKitEscrow.sol:SettleKitEscrow "$escrow_args"

say "Done"
echo "OperatorVault   $EXPLORER/address/$vault"
echo "SettleKitEscrow $EXPLORER/address/$escrow"
echo "Sourcify        https://repo.sourcify.dev/$CHAIN_ID/$vault"
echo "Next: commit contracts/deployments/arc-mainnet.json, post on X tagging @thecanteenapp,"
echo "then run arc-canteen submit-showcase with these addresses (see docs/tameion/MAINNET-BOUNTY.md)."
