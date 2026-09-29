// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../src/interfaces/IERC20.sol";
import {OperatorVault} from "../src/OperatorVault.sol";

/** Minimal cheatcode surface for a forge script (avoids a forge-std dependency). */
interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/**
 * Deploy OperatorVault (SettleKit autonomous operator guard rails) to Arc.
 *
 * Env:
 *   OPERATOR_VAULT_OWNER      required — human owner (approves escalations, sets policy)
 *   OPERATOR_VAULT_OPERATOR   required — agent's Circle DCW address on ARC-TESTNET
 *   ARC_USDC_ADDRESS          default 0x3600…0000 (Arc testnet USDC)
 *   OPERATOR_PER_TX_CAP       default 1000e6 (USDC base units, 6 dp)
 *   OPERATOR_DAILY_CAP        default 1500e6
 *   OPERATOR_ESCALATE_ABOVE   default 500e6
 *
 * Dry-run (simulation, no broadcast):
 *   OPERATOR_VAULT_OWNER=0x.. OPERATOR_VAULT_OPERATOR=0x.. forge script script/DeployOperator.s.sol
 * Broadcast (faucet-funded deployer; USDC is the gas token on Arc):
 *   forge script script/DeployOperator.s.sol --rpc-url https://rpc.testnet.arc.network \
 *     --private-key $DEPLOYER_KEY --broadcast
 */
contract DeployOperator {
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address internal constant DEFAULT_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant DEFAULT_PER_TX_CAP = 1_000e6;
    uint256 internal constant DEFAULT_DAILY_CAP = 1_500e6;
    uint256 internal constant DEFAULT_ESCALATE_ABOVE = 500e6;

    function run() external returns (address vault) {
        address usdc = vm.envOr("ARC_USDC_ADDRESS", DEFAULT_USDC);
        address owner = vm.envAddress("OPERATOR_VAULT_OWNER");
        address operator = vm.envAddress("OPERATOR_VAULT_OPERATOR");
        uint256 perTxCap = vm.envOr("OPERATOR_PER_TX_CAP", DEFAULT_PER_TX_CAP);
        uint256 dailyCap = vm.envOr("OPERATOR_DAILY_CAP", DEFAULT_DAILY_CAP);
        uint256 escalateAbove = vm.envOr("OPERATOR_ESCALATE_ABOVE", DEFAULT_ESCALATE_ABOVE);

        vm.startBroadcast();
        OperatorVault deployed =
            new OperatorVault(IERC20(usdc), owner, operator, perTxCap, dailyCap, escalateAbove);
        vm.stopBroadcast();

        vault = address(deployed);
    }
}
