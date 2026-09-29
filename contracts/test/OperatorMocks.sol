// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../src/interfaces/IERC20.sol";
import {IYieldAdapter} from "../src/interfaces/IYieldAdapter.sol";
import {OperatorVault} from "../src/OperatorVault.sol";

/**
 * Token that re-enters the vault from inside `transfer`. Deployed as the vault
 * operator so the nested `pay` passes the role check and only the reentrancy
 * lock / effects ordering can stop it. Records what it observed mid-transfer.
 */
contract ReentrantToken is IERC20 {
    mapping(address => uint256) public override balanceOf;
    OperatorVault public vault;
    address public payee;
    bool public armed;
    bool public reentered;
    bytes4 public reentryError;
    uint256 public observedOperating;
    uint256 public observedSpentToday;

    function arm(OperatorVault vault_, address payee_) external {
        vault = vault_;
        payee = payee_;
        armed = true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (armed && msg.sender == address(vault)) {
            armed = false;
            observedOperating = vault.bucketBalance(OperatorVault.Bucket.OPERATING);
            observedSpentToday = vault.spentToday();
            try vault.pay(bytes32("reenter"), OperatorVault.Bucket.OPERATING, payee, amount) {
                reentered = true;
            } catch (bytes memory reason) {
                reentryError = bytes4(reason);
            }
        }
        return true;
    }

    /** Operator call helper: lets the test drive the vault as this contract. */
    function callPay(OperatorVault.Bucket bucket, address to, uint256 amount) external returns (uint256) {
        return vault.pay(bytes32("outer"), bucket, to, amount);
    }

    function callAllocate(uint256[4] calldata amounts) external {
        vault.allocate(bytes32("alloc"), amounts);
    }
}

/** 1:1 USYC stand-in: holds deposited USDC and returns it on redeem. */
contract MockYieldAdapter is IYieldAdapter {
    IERC20 public immutable usdc;
    mapping(address => uint256) public principal;

    constructor(IERC20 usdc_) {
        usdc = usdc_;
    }

    function deposit(uint256 usdcAmount) external returns (uint256) {
        principal[msg.sender] += usdcAmount;
        return usdcAmount;
    }

    function redeem(uint256 usdcAmount, address to) external returns (uint256) {
        principal[msg.sender] -= usdcAmount;
        require(usdc.transfer(to, usdcAmount), "transfer");
        return usdcAmount;
    }

    function totalValue(address holder) external view returns (uint256) {
        return principal[holder];
    }
}
