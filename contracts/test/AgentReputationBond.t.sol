// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, MockERC20} from "./Helpers.sol";
import {AgentReputationBond} from "../src/AgentReputationBond.sol";

contract AgentReputationBondTest is Test {
    MockERC20 internal usdc;
    AgentReputationBond internal bond;

    address internal broker = address(0xB80E2);
    address internal client = address(0xC11E2);
    address internal arbiter = address(0xA2B1);
    bytes32 internal constant ID = keccak256("match-1");

    function setUp() public {
        usdc = new MockERC20();
        bond = new AgentReputationBond(usdc);
        usdc.mint(broker, 100);
        vm.prank(broker);
        usdc.approve(address(bond), 100);
    }

    function testPostHoldsTheBond() public {
        vm.prank(broker);
        bond.post(ID, client, arbiter, 50);
        assertEq(usdc.balanceOf(address(bond)), 50);
        assertEq(usdc.balanceOf(broker), 50);
    }

    function testReleaseReturnsToBroker() public {
        vm.prank(broker);
        bond.post(ID, client, arbiter, 50);
        vm.prank(client);
        bond.release(ID);
        assertEq(usdc.balanceOf(broker), 100);
        assertEq(usdc.balanceOf(address(bond)), 0);
    }

    function testSlashPaysClient() public {
        vm.prank(broker);
        bond.post(ID, client, arbiter, 50);
        vm.prank(arbiter);
        bond.slash(ID);
        assertEq(usdc.balanceOf(client), 50);
        assertEq(usdc.balanceOf(address(bond)), 0);
    }

    function testOnlyAuthorizedCanSlash() public {
        vm.prank(broker);
        bond.post(ID, client, arbiter, 50);
        vm.prank(client); // client cannot slash (only broker/arbiter)
        vm.expectRevert(AgentReputationBond.NotAuthorized.selector);
        bond.slash(ID);
    }
}
