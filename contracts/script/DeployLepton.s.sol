// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../src/interfaces/IERC20.sol";
import {RecursiveSplitDistributor} from "../src/RecursiveSplitDistributor.sol";
import {LeptonStreamSettlement} from "../src/LeptonStreamSettlement.sol";
import {AgentReputationBond} from "../src/AgentReputationBond.sol";

/** Minimal cheatcode surface for a forge script (avoids a forge-std dependency). */
interface Vm {
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/**
 * Deploy the three Lepton on-chain settlement contracts to Arc:
 *   - RecursiveSplitDistributor — fan out a citation/remix lineage in one tx (RFB 6)
 *   - LeptonStreamSettlement     — per-second deposit/accrue/settle/close stream (RFB 4)
 *   - AgentReputationBond        — ERC-8004-style bond post/release/slash (RFB 3)
 *
 * All three settle the same asset; on Arc that is USDC, the native gas token,
 * which also exposes a 6-decimal ERC-20 interface at the address below.
 *
 * Env (Arc testnet default is the real bundled USDC address):
 *   ARC_USDC_ADDRESS   default 0x3600…0000 (USDC, native gas token)
 *
 * Dry-run (simulation, no broadcast):
 *   forge script script/DeployLepton.s.sol
 * Broadcast (needs a faucet-funded deployer; USDC is the gas token):
 *   forge script script/DeployLepton.s.sol --rpc-url https://rpc.testnet.arc.network \
 *     --private-key $DEPLOYER_KEY --broadcast
 */
contract DeployLepton {
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address internal constant DEFAULT_USDC = 0x3600000000000000000000000000000000000000;

    function run()
        external
        returns (address distributor, address stream, address bond)
    {
        IERC20 usdc = IERC20(vm.envOr("ARC_USDC_ADDRESS", DEFAULT_USDC));

        vm.startBroadcast();
        RecursiveSplitDistributor distributorC = new RecursiveSplitDistributor(usdc);
        LeptonStreamSettlement streamC = new LeptonStreamSettlement(usdc);
        AgentReputationBond bondC = new AgentReputationBond(usdc);
        vm.stopBroadcast();

        distributor = address(distributorC);
        stream = address(streamC);
        bond = address(bondC);
    }
}
