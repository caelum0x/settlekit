// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract IntentRepaymentEscrow {
    // This record ties one user intent to the fulfiller that should be reimbursed later.
    struct IntentRepayment {
        address fulfiller;
        address recipient;
        uint256 amount;
        bool repaid;
    }

    IERC20Like public immutable USDC;
    address public immutable OPERATOR;
    mapping(bytes32 => IntentRepayment) public repayments;

    error OnlyOperator();
    error RepaymentExists();
    error RepaymentMissing();
    error AlreadyRepaid();
    error NothingToRelease();
    error TransferFailed();

    event IntentRepaymentRegistered(bytes32 indexed intentId, address indexed fulfiller, uint256 amount, address recipient);
    event RepaidToFulfiller(bytes32 indexed intentId, address indexed fulfiller, uint256 amount);

    constructor(address usdcAddress, address operatorAddress) {
        USDC = IERC20Like(usdcAddress);
        OPERATOR = operatorAddress;
    }

    modifier onlyOperator() {
        if (msg.sender != OPERATOR) revert OnlyOperator();
        _;
    }

    // The operator records who fronted the payout before the later CCTP mint arrives.
    function registerIntentRepayment(
        bytes32 intentId,
        address fulfiller,
        uint256 amount,
        address recipient
    ) external onlyOperator {
        if (repayments[intentId].fulfiller != address(0)) revert RepaymentExists();
        repayments[intentId] = IntentRepayment({
            fulfiller: fulfiller,
            recipient: recipient,
            amount: amount,
            repaid: false
        });
        emit IntentRepaymentRegistered(intentId, fulfiller, amount, recipient);
    }

    // After CCTP mints into this contract, the operator releases those funds to the recorded fulfiller.
    function releaseToFulfiller(bytes32 intentId) external onlyOperator {
        IntentRepayment storage repayment = repayments[intentId];
        if (repayment.fulfiller == address(0)) revert RepaymentMissing();
        if (repayment.repaid) revert AlreadyRepaid();
        if (USDC.balanceOf(address(this)) < repayment.amount) revert NothingToRelease();
        repayment.repaid = true;
        bool ok = USDC.transfer(repayment.fulfiller, repayment.amount);
        if (!ok) revert TransferFailed();
        emit RepaidToFulfiller(intentId, repayment.fulfiller, repayment.amount);
    }
}
