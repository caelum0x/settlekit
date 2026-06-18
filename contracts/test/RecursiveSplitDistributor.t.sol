// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, MockERC20} from "./Helpers.sol";
import {RecursiveSplitDistributor} from "../src/RecursiveSplitDistributor.sol";

contract RecursiveSplitDistributorTest is Test {
    MockERC20 internal usdc;
    RecursiveSplitDistributor internal dist;

    address internal payer = address(0xBEEF);
    address internal authorA = address(0xA);
    address internal authorB = address(0xB);
    address internal authorC = address(0xC);
    bytes32 internal constant ID = keccak256("access-1");

    function setUp() public {
        usdc = new MockERC20();
        dist = new RecursiveSplitDistributor(usdc);
        usdc.mint(payer, 1_000);
        vm.prank(payer);
        usdc.approve(address(dist), 1_000);
    }

    function testDistributesLineageInOneTx() public {
        address[] memory recipients = new address[](3);
        recipients[0] = authorA;
        recipients[1] = authorB;
        recipients[2] = authorC;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 390;
        amounts[1] = 195;
        amounts[2] = 234;

        vm.prank(payer);
        dist.distribute(ID, recipients, amounts);

        assertEq(usdc.balanceOf(authorA), 390);
        assertEq(usdc.balanceOf(authorB), 195);
        assertEq(usdc.balanceOf(authorC), 234);
        assertEq(usdc.balanceOf(payer), 1_000 - 819);
        assertEq(usdc.balanceOf(address(dist)), 0);
    }

    function testRejectsLengthMismatch() public {
        address[] memory recipients = new address[](1);
        recipients[0] = authorA;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 2;

        vm.prank(payer);
        vm.expectRevert(RecursiveSplitDistributor.LengthMismatch.selector);
        dist.distribute(ID, recipients, amounts);
    }

    function testRejectsZeroTotal() public {
        address[] memory recipients = new address[](1);
        recipients[0] = authorA;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0;

        vm.prank(payer);
        vm.expectRevert(RecursiveSplitDistributor.ZeroTotal.selector);
        dist.distribute(ID, recipients, amounts);
    }
}
