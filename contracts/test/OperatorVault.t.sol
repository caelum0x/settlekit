// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, MockERC20} from "./Helpers.sol";
import {ReentrantToken, MockYieldAdapter} from "./OperatorMocks.sol";
import {OperatorVault} from "../src/OperatorVault.sol";
import {IYieldAdapter} from "../src/interfaces/IYieldAdapter.sol";

/**
 * Parity note: the numeric cases here (caps, window, order of checks) are
 * mirrored one-for-one by packages/operator/test/policy-parity.test.ts.
 */
contract OperatorVaultTest is Test {
    MockERC20 internal usdc;
    OperatorVault internal vault;

    address internal owner = address(0x0A11CE);
    address internal operator = address(0xA6E27);
    address internal vendor = address(0x7E2D02);
    address internal stranger = address(0xBAD);

    uint256 internal constant PER_TX = 1_000e6;
    uint256 internal constant DAILY = 1_500e6;
    uint256 internal constant ESCALATE_ABOVE = 500e6;
    uint256 internal constant T0 = 1_760_000_000; // 2025-10-09T08:53:20Z
    bytes32 internal constant H = keccak256("decision-1");

    OperatorVault.Bucket internal constant OPERATING = OperatorVault.Bucket.OPERATING;
    OperatorVault.Bucket internal constant TAX = OperatorVault.Bucket.TAX;
    OperatorVault.Bucket internal constant YIELD = OperatorVault.Bucket.YIELD;
    OperatorVault.Bucket internal constant REFUND = OperatorVault.Bucket.REFUND;

    function setUp() public {
        vm.warp(T0);
        usdc = new MockERC20();
        vault = new OperatorVault(usdc, owner, operator, PER_TX, DAILY, ESCALATE_ABOVE);
        vm.prank(owner);
        vault.setAllowlist(H, vendor, true);
    }

    function _fundAndAllocate(uint256 operating, uint256 tax, uint256 yield_, uint256 refund) internal {
        usdc.mint(address(vault), operating + tax + yield_ + refund);
        vm.prank(operator);
        vault.allocate(H, [operating, tax, yield_, refund]);
    }

    function _pay(OperatorVault.Bucket bucket, address to, uint256 amount) internal returns (uint256) {
        vm.prank(operator);
        return vault.pay(H, bucket, to, amount);
    }

    // ----------------------------------------------------------- allocation

    function testAllocateSplitsUnallocatedInflow() public {
        usdc.mint(address(vault), 10_000e6);
        assertEq(vault.unallocated(), 10_000e6);
        vm.prank(operator);
        vault.allocate(H, [uint256(6_000e6), 2_500e6, 1_000e6, 500e6]);
        assertEq(vault.bucketBalance(OPERATING), 6_000e6);
        assertEq(vault.bucketBalance(TAX), 2_500e6);
        assertEq(vault.bucketBalance(YIELD), 1_000e6);
        assertEq(vault.bucketBalance(REFUND), 500e6);
        assertEq(vault.unallocated(), 0);
    }

    function testOverAllocationReverts() public {
        usdc.mint(address(vault), 100e6);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.OverAllocation.selector);
        vault.allocate(H, [uint256(60e6), 30e6, 10e6, 1]);
    }

    function testAllocateCannotReuseAllocatedFunds() public {
        _fundAndAllocate(100e6, 0, 0, 0);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.OverAllocation.selector);
        vault.allocate(H, [uint256(1), 0, 0, 0]);
    }

    // ------------------------------------------------------------- payments

    function testPayWithinCapsTransfers() public {
        _fundAndAllocate(2_000e6, 0, 0, 0);
        uint256 id = _pay(OPERATING, vendor, 400e6);
        assertEq(id, 0);
        assertEq(usdc.balanceOf(vendor), 400e6);
        assertEq(vault.bucketBalance(OPERATING), 1_600e6);
        assertEq(vault.spentToday(), 400e6);
    }

    function testPerTxCapReverts() public {
        _fundAndAllocate(5_000e6, 0, 0, 0);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.PerTxCapExceeded.selector);
        vault.pay(H, OPERATING, vendor, PER_TX + 1);
    }

    function testDailyCapAndUtcRollover() public {
        _fundAndAllocate(5_000e6, 0, 0, 0);
        _pay(OPERATING, vendor, 500e6);
        _pay(OPERATING, vendor, 500e6);
        _pay(OPERATING, vendor, 500e6);
        assertEq(vault.spentToday(), DAILY);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.DailyCapExceeded.selector);
        vault.pay(H, OPERATING, vendor, 1);

        // Next UTC day starts a fresh window.
        uint256 nextDay = (T0 / 1 days + 1) * 1 days;
        vm.warp(nextDay);
        assertEq(vault.spentToday(), 0);
        _pay(OPERATING, vendor, 500e6);
        assertEq(vault.spentToday(), 500e6);
    }

    function testDailyWindowIsUtcDayNotRolling24h() public {
        _fundAndAllocate(5_000e6, 0, 0, 0);
        uint256 lastSecond = (T0 / 1 days + 1) * 1 days - 1;
        vm.warp(lastSecond);
        _pay(OPERATING, vendor, 500e6);
        _pay(OPERATING, vendor, 500e6);
        _pay(OPERATING, vendor, 500e6);
        vm.warp(lastSecond + 1);
        _pay(OPERATING, vendor, 500e6);
        assertEq(vault.spentToday(), 500e6);
    }

    function testAllowlistEnforced() public {
        _fundAndAllocate(1_000e6, 0, 0, 0);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.NotAllowlisted.selector);
        vault.pay(H, OPERATING, stranger, 10e6);

        vm.prank(owner);
        vault.setAllowlist(H, vendor, false);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.NotAllowlisted.selector);
        vault.pay(H, OPERATING, vendor, 10e6);
    }

    function testTaxBucketNeverOperatorSpendable() public {
        _fundAndAllocate(0, 1_000e6, 0, 0);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.TaxLocked.selector);
        vault.pay(H, TAX, vendor, 10e6);

        // Owner can still withdraw the reserve.
        vm.prank(owner);
        vault.ownerWithdraw(H, TAX, owner, 1_000e6);
        assertEq(usdc.balanceOf(owner), 1_000e6);
        assertEq(vault.bucketBalance(TAX), 0);
    }

    function testInsufficientBucketReverts() public {
        _fundAndAllocate(100e6, 0, 0, 50e6);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.InsufficientBucket.selector);
        vault.pay(H, REFUND, vendor, 60e6);
    }

    function testZeroAmountReverts() public {
        _fundAndAllocate(100e6, 0, 0, 0);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.ZeroAmount.selector);
        vault.pay(H, OPERATING, vendor, 0);
    }

    // ---------------------------------------------------------- escalations

    function testEscalateThenApproveExecutes() public {
        _fundAndAllocate(2_000e6, 0, 0, 0);
        uint256 id = _pay(OPERATING, vendor, 800e6);
        assertEq(id, 1);
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(vault.bucketBalance(OPERATING), 1_200e6);
        assertEq(vault.pendingReserved(), 800e6);
        assertTrue(vault.escalation(id).status == OperatorVault.Status.Pending);

        vm.prank(owner);
        vault.approve(id);
        assertEq(usdc.balanceOf(vendor), 800e6);
        assertEq(vault.pendingReserved(), 0);
        assertEq(vault.spentToday(), 800e6);
        assertTrue(vault.escalation(id).status == OperatorVault.Status.Approved);

        vm.prank(owner);
        vm.expectRevert(OperatorVault.NotPending.selector);
        vault.approve(id);
    }

    function testEscalateThenRejectRestoresBucket() public {
        _fundAndAllocate(2_000e6, 0, 0, 0);
        uint256 id = _pay(OPERATING, vendor, 800e6);
        vm.prank(owner);
        vault.reject(id);
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(vault.bucketBalance(OPERATING), 2_000e6);
        assertEq(vault.pendingReserved(), 0);
        assertEq(vault.unallocated(), 0);
        assertTrue(vault.escalation(id).status == OperatorVault.Status.Rejected);
    }

    function testEscalationExpiresAfter72h() public {
        _fundAndAllocate(2_000e6, 0, 0, 0);
        uint256 id = _pay(OPERATING, vendor, 800e6);
        vm.expectRevert(OperatorVault.EscalationNotExpired.selector);
        vault.expire(id);

        vm.warp(T0 + 72 hours + 1);
        vm.prank(owner);
        vm.expectRevert(OperatorVault.EscalationExpired.selector);
        vault.approve(id);

        vm.prank(stranger);
        vault.expire(id);
        assertEq(vault.bucketBalance(OPERATING), 2_000e6);
        assertTrue(vault.escalation(id).status == OperatorVault.Status.Expired);
    }

    function testEscalationSkipsDailyCapButPerTxCapStillApplies() public {
        _fundAndAllocate(5_000e6, 0, 0, 0);
        _pay(OPERATING, vendor, 500e6);
        _pay(OPERATING, vendor, 500e6);
        _pay(OPERATING, vendor, 500e6);
        uint256 id = _pay(OPERATING, vendor, 900e6);
        assertEq(id, 1);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.PerTxCapExceeded.selector);
        vault.pay(H, OPERATING, vendor, 1_001e6);
    }

    // ------------------------------------------------------- pause and roles

    function testPauseBlocksOperatorAndUnpauseRestores() public {
        _fundAndAllocate(1_000e6, 0, 0, 0);
        vm.prank(owner);
        vault.pause();
        vm.prank(operator);
        vm.expectRevert(OperatorVault.IsPaused.selector);
        vault.pay(H, OPERATING, vendor, 10e6);
        usdc.mint(address(vault), 10e6);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.IsPaused.selector);
        vault.allocate(H, [uint256(10e6), 0, 0, 0]);

        vm.prank(owner);
        vault.unpause();
        _pay(OPERATING, vendor, 10e6);
        assertEq(usdc.balanceOf(vendor), 10e6);
    }

    function testOnlyOperatorAndOnlyOwner() public {
        _fundAndAllocate(1_000e6, 0, 0, 0);
        vm.prank(owner);
        vm.expectRevert(OperatorVault.NotOperator.selector);
        vault.pay(H, OPERATING, vendor, 10e6);

        vm.prank(operator);
        vm.expectRevert(OperatorVault.NotOwner.selector);
        vault.setCaps(H, 1, 1, 1);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.NotOwner.selector);
        vault.setAllowlist(H, stranger, true);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.NotOwner.selector);
        vault.pause();
        vm.prank(operator);
        vm.expectRevert(OperatorVault.NotOwner.selector);
        vault.approve(1);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.NotOwner.selector);
        vault.ownerWithdraw(H, TAX, operator, 1);
    }

    function testOwnerSettersValidateCaps() public {
        vm.prank(owner);
        vm.expectRevert(OperatorVault.InvalidCaps.selector);
        vault.setCaps(H, 100, 50, 10); // daily < perTx
        vm.prank(owner);
        vm.expectRevert(OperatorVault.InvalidCaps.selector);
        vault.setCaps(H, 100, 500, 200); // escalateAbove > perTx
        vm.prank(owner);
        vault.setCaps(H, 200e6, 400e6, 100e6);
        assertEq(vault.perTxCap(), 200e6);
        assertEq(vault.dailyCap(), 400e6);
        assertEq(vault.escalateAbove(), 100e6);
    }

    // ---------------------------------------------------------------- yield

    function testYieldDisabledWhenAdapterUnset() public {
        _fundAndAllocate(0, 0, 1_000e6, 0);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.YieldDisabled.selector);
        vault.sweepToYield(H, 100e6);
        vm.prank(operator);
        vm.expectRevert(OperatorVault.YieldDisabled.selector);
        vault.redeemFromYield(H, 100e6);
    }

    function testSweepAndRedeemThroughAdapter() public {
        MockYieldAdapter adapter = new MockYieldAdapter(usdc);
        vm.prank(owner);
        vault.setYieldAdapter(H, IYieldAdapter(address(adapter)));
        _fundAndAllocate(0, 0, 1_000e6, 0);

        vm.prank(operator);
        vault.sweepToYield(H, 600e6);
        assertEq(vault.bucketBalance(YIELD), 400e6);
        assertEq(vault.yieldDeployed(), 600e6);
        assertEq(adapter.totalValue(address(vault)), 600e6);
        assertEq(vault.unallocated(), 0);

        vm.prank(operator);
        vault.redeemFromYield(H, 250e6);
        assertEq(vault.bucketBalance(YIELD), 650e6);
        assertEq(vault.yieldDeployed(), 350e6);

        vm.prank(operator);
        vm.expectRevert(OperatorVault.InsufficientYield.selector);
        vault.redeemFromYield(H, 351e6);

        vm.prank(owner);
        vm.expectRevert(OperatorVault.InsufficientYield.selector);
        vault.setYieldAdapter(H, IYieldAdapter(address(0)));
    }

    // ----------------------------------------------------------- reentrancy

    function testReentrantTokenCannotDoubleSpend() public {
        ReentrantToken evil = new ReentrantToken();
        OperatorVault v = new OperatorVault(evil, owner, address(evil), PER_TX, DAILY, ESCALATE_ABOVE);
        vm.prank(owner);
        v.setAllowlist(H, vendor, true);
        evil.mint(address(v), 1_000e6);
        evil.arm(v, vendor);
        evil.callAllocate([uint256(1_000e6), 0, 0, 0]);

        evil.callPay(OPERATING, vendor, 400e6);

        assertTrue(!evil.reentered());
        assertTrue(evil.reentryError() == OperatorVault.Reentrancy.selector);
        // Effects were final before the external transfer.
        assertEq(evil.observedOperating(), 600e6);
        assertEq(evil.observedSpentToday(), 400e6);
        assertEq(evil.balanceOf(vendor), 400e6);
        assertEq(v.bucketBalance(OPERATING), 600e6);
    }
}
