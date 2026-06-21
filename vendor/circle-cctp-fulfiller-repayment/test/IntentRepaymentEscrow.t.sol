// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "../contracts/IntentRepaymentEscrow.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract IntentRepaymentEscrowTest {
    MockUSDC internal usdc;
    IntentRepaymentEscrow internal escrow;
    address internal operator = address(this);
    address internal fulfiller = address(0xCAFE);
    address internal recipient = address(0xF00D);
    bytes32 internal intentId = keccak256("intent-1");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new IntentRepaymentEscrow(address(usdc), operator);
    }

    function testRegistersAndRepaysSelectedFulfiller() public {
        escrow.registerIntentRepayment(intentId, fulfiller, 5e6, recipient);

        usdc.mint(address(escrow), 5e6);

        escrow.releaseToFulfiller(intentId);

        assert(usdc.balanceOf(fulfiller) == 5e6);
    }
}
