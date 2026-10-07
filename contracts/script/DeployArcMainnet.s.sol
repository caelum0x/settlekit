// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../src/interfaces/IERC20.sol";
import {OperatorVault} from "../src/OperatorVault.sol";
import {SettleKitEscrow} from "../src/SettleKitEscrow.sol";

/** Minimal cheatcode surface for a forge script (avoids a forge-std dependency). */
interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/**
 * Deploy SettleKit's Arc contracts to Arc MAINNET (chain id 5042):
 *   - OperatorVault   (Tameion operator guard rails)
 *   - SettleKitEscrow (buyer/seller/arbiter USDC escrow)
 *
 * SettleKitCctpHook is deliberately NOT deployed: CCTP V2's MessageTransmitterV2
 * calls the message recipient (TokenMessengerV2), never the mintRecipient, so the
 * hook's handlers would never run and minted USDC would be stranded in it.
 * See docs/tameion/MAINNET-BOUNTY.md.
 *
 * Run through script/deploy-arc-mainnet.sh, which checks the chain and the USDC
 * contract over RPC, simulates, asks for confirmation, broadcasts and verifies.
 *
 * Env (all set by the wrapper):
 *   OPERATOR_VAULT_OWNER, OPERATOR_VAULT_OPERATOR
 *   OPERATOR_PER_TX_CAP, OPERATOR_DAILY_CAP, OPERATOR_ESCALATE_ABOVE  (USDC, 6 dp)
 */
contract DeployArcMainnet {
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;
    /// USDC ERC-20 interface on Arc mainnet (docs.arc.io/arc/references/contract-addresses).
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    error WrongChain(uint256 chainId);

    function run() external returns (address vault, address escrow) {
        if (block.chainid != ARC_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        address owner = vm.envAddress("OPERATOR_VAULT_OWNER");
        address operator = vm.envAddress("OPERATOR_VAULT_OPERATOR");
        uint256 perTxCap = vm.envUint("OPERATOR_PER_TX_CAP");
        uint256 dailyCap = vm.envUint("OPERATOR_DAILY_CAP");
        uint256 escalateAbove = vm.envUint("OPERATOR_ESCALATE_ABOVE");

        vm.startBroadcast();
        OperatorVault vaultC =
            new OperatorVault(IERC20(ARC_USDC), owner, operator, perTxCap, dailyCap, escalateAbove);
        SettleKitEscrow escrowC = new SettleKitEscrow(IERC20(ARC_USDC));
        vm.stopBroadcast();

        vault = address(vaultC);
        escrow = address(escrowC);
    }
}
