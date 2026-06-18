// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, MockERC20} from "./Helpers.sol";
import {LeptonStreamSettlement} from "../src/LeptonStreamSettlement.sol";

contract LeptonStreamSettlementTest is Test {
    MockERC20 internal usdc;
    LeptonStreamSettlement internal stream;

    address internal viewer = address(0x71E3);
    address internal streamer = address(0x57EA);
    bytes32 internal constant ID = keccak256("session-1");

    uint256 internal constant RATE = 1; // 1 token/sec
    uint256 internal constant RESERVE = 100;

    function setUp() public {
        usdc = new MockERC20();
        stream = new LeptonStreamSettlement(usdc);
        usdc.mint(viewer, 1_000);
        vm.prank(viewer);
        usdc.approve(address(stream), 1_000);
        vm.warp(1_000_000);
        vm.prank(viewer);
        stream.open(ID, streamer, RATE, RESERVE);
    }

    function testAccruesAndSettlesByTheSecond() public {
        vm.warp(1_000_010); // 10 seconds later
        assertEq(stream.accrued(ID), 10);
        vm.prank(streamer);
        uint256 paid = stream.settle(ID);
        assertEq(paid, 10);
        assertEq(usdc.balanceOf(streamer), 10);
    }

    function testPauseExcludesTime() public {
        vm.warp(1_000_005); // watched 5s
        vm.prank(viewer);
        stream.pause(ID);
        vm.warp(1_000_100); // 95s paused — not billed
        assertEq(stream.accrued(ID), 5);
        vm.prank(viewer);
        stream.resume(ID);
        vm.warp(1_000_101); // 1s after resume
        assertEq(stream.accrued(ID), 6);
    }

    function testCapsAccrualAtReserve() public {
        vm.warp(2_000_000); // far beyond the reserve
        assertEq(stream.accrued(ID), RESERVE);
        assertEq(stream.refundable(ID), 0);
    }

    function testCloseSettlesTailAndRefundsRemainder() public {
        vm.warp(1_000_005); // watched 5s of a 100 reserve
        vm.prank(viewer);
        (uint256 settledTotal, uint256 refund) = stream.close(ID);
        assertEq(settledTotal, 5);
        assertEq(refund, 95);
        assertEq(usdc.balanceOf(streamer), 5);
        assertEq(usdc.balanceOf(viewer), 1_000 - 5); // reserve out then 95 back
    }

    function testOnlyPartyCanSettle() public {
        vm.warp(1_000_010);
        vm.prank(address(0xBAD));
        vm.expectRevert(LeptonStreamSettlement.NotParty.selector);
        stream.settle(ID);
    }
}
