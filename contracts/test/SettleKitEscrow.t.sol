// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, MockERC20} from "./Helpers.sol";
import {SettleKitEscrow} from "../src/SettleKitEscrow.sol";

contract SettleKitEscrowTest is Test {
    MockERC20 internal usdc;
    SettleKitEscrow internal escrow;

    address internal buyer = address(0xB0B);
    address internal seller = address(0x5E11E2);
    address internal arbiter = address(0xA121742);

    bytes32 internal constant ID = keccak256("order-1");
    uint256 internal constant AMOUNT = 100e6;

    function setUp() public {
        usdc = new MockERC20();
        escrow = new SettleKitEscrow(usdc);
        usdc.mint(buyer, AMOUNT);
        vm.prank(buyer);
        usdc.approve(address(escrow), AMOUNT);
    }

    function _fund() internal {
        vm.prank(buyer);
        escrow.createAndFund(ID, seller, arbiter, AMOUNT);
    }

    function testCreateAndFundPullsFunds() public {
        _fund();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(usdc.balanceOf(buyer), 0);
        assertTrue(escrow.escrows(ID).state == SettleKitEscrow.State.Funded);
    }

    function testBuyerCanRelease() public {
        _fund();
        vm.prank(buyer);
        escrow.release(ID);
        assertEq(usdc.balanceOf(seller), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testArbiterCanRelease() public {
        _fund();
        vm.prank(arbiter);
        escrow.release(ID);
        assertEq(usdc.balanceOf(seller), AMOUNT);
    }

    function testSellerCanRefund() public {
        _fund();
        vm.prank(seller);
        escrow.refund(ID);
        assertEq(usdc.balanceOf(buyer), AMOUNT);
    }

    function testDisputeThenArbiterResolves() public {
        _fund();
        vm.prank(buyer);
        escrow.dispute(ID);
        assertTrue(escrow.escrows(ID).state == SettleKitEscrow.State.Disputed);
        vm.prank(arbiter);
        escrow.refund(ID);
        assertEq(usdc.balanceOf(buyer), AMOUNT);
    }

    function testStrangerCannotRelease() public {
        _fund();
        vm.prank(address(0xDEAD));
        vm.expectRevert(SettleKitEscrow.NotAuthorized.selector);
        escrow.release(ID);
    }

    function testSellerCannotRelease() public {
        _fund();
        vm.prank(seller);
        vm.expectRevert(SettleKitEscrow.NotAuthorized.selector);
        escrow.release(ID);
    }

    function testDoubleFundReverts() public {
        _fund();
        vm.prank(buyer);
        vm.expectRevert(SettleKitEscrow.AlreadyExists.selector);
        escrow.createAndFund(ID, seller, arbiter, AMOUNT);
    }

    function testCannotReleaseAfterReleased() public {
        _fund();
        vm.prank(buyer);
        escrow.release(ID);
        vm.prank(arbiter);
        vm.expectRevert(SettleKitEscrow.NotFundedOrDisputed.selector);
        escrow.release(ID);
    }
}
