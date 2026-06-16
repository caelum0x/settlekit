// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, MockERC20} from "./Helpers.sol";
import {SettleKitCctpHook} from "../src/SettleKitCctpHook.sol";

contract SettleKitCctpHookTest is Test {
    MockERC20 internal usdc;
    SettleKitCctpHook internal hook;

    address internal transmitter = address(0x7A);
    address internal merchant = address(0x11E2C);
    bytes32 internal constant ORDER = keccak256("order-x");
    uint256 internal constant AMOUNT = 50e6;

    function setUp() public {
        usdc = new MockERC20();
        hook = new SettleKitCctpHook(transmitter, usdc);
        // Simulate CCTP minting USDC to the hook (it is the mintRecipient).
        usdc.mint(address(hook), AMOUNT);
    }

    /** A BurnMessageV2 body: a 228-byte header followed by the hookData. */
    function _body(bytes memory hookData) internal pure returns (bytes memory) {
        return abi.encodePacked(new bytes(228), hookData);
    }

    function testForwardsMintedUsdcToMerchant() public {
        bytes memory body = _body(abi.encode(merchant, ORDER));
        vm.prank(transmitter);
        bool ok = hook.handleReceiveFinalizedMessage(6, bytes32(0), 1000, body);
        assertTrue(ok);
        assertEq(usdc.balanceOf(merchant), AMOUNT);
        assertEq(usdc.balanceOf(address(hook)), 0);
    }

    function testUnfinalizedAlsoSettles() public {
        bytes memory body = _body(abi.encode(merchant, ORDER));
        vm.prank(transmitter);
        hook.handleReceiveUnfinalizedMessage(6, bytes32(0), 500, body);
        assertEq(usdc.balanceOf(merchant), AMOUNT);
    }

    function testRejectsNonTransmitter() public {
        bytes memory body = _body(abi.encode(merchant, ORDER));
        vm.prank(address(0xBAD));
        vm.expectRevert(SettleKitCctpHook.NotMessageTransmitter.selector);
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 1000, body);
    }

    function testRevertsWithoutHookData() public {
        bytes memory body = new bytes(228); // header only, no hookData
        vm.prank(transmitter);
        vm.expectRevert(SettleKitCctpHook.NoHookData.selector);
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 1000, body);
    }
}
