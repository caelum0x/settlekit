// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../src/interfaces/IERC20.sol";
import {SettleKitEscrow} from "../src/SettleKitEscrow.sol";
import {SettleKitCctpHook} from "../src/SettleKitCctpHook.sol";

/** Minimal cheatcode surface for a forge script (avoids a forge-std dependency). */
interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/**
 * Deploy SettleKitEscrow + SettleKitCctpHook to Arc.
 *
 * Env (Arc testnet defaults are the real bundled addresses):
 *   ARC_USDC_ADDRESS              default 0x3600…0000 (USDC, native gas token)
 *   ARC_MESSAGE_TRANSMITTER_V2    default 0xE737…CE275 (CCTP MessageTransmitterV2)
 *
 * Dry-run (simulation, no broadcast):
 *   forge script script/Deploy.s.sol
 * Broadcast (needs a faucet-funded deployer; USDC is the gas token):
 *   forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network \
 *     --private-key $DEPLOYER_KEY --broadcast
 */
contract Deploy {
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address internal constant DEFAULT_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant DEFAULT_MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    function run() external returns (address escrow, address hook) {
        address usdc = vm.envOr("ARC_USDC_ADDRESS", DEFAULT_USDC);
        address transmitter = vm.envOr("ARC_MESSAGE_TRANSMITTER_V2", DEFAULT_MESSAGE_TRANSMITTER);

        vm.startBroadcast();
        SettleKitEscrow escrowC = new SettleKitEscrow(IERC20(usdc));
        SettleKitCctpHook hookC = new SettleKitCctpHook(transmitter, IERC20(usdc));
        vm.stopBroadcast();

        escrow = address(escrowC);
        hook = address(hookC);
    }
}
