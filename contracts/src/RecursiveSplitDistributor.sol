// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * RecursiveSplitDistributor — pay a citation/remix lineage in one transaction.
 *
 * The recursive royalty split is computed off-chain (the settlekit/citation-toll
 * engine flattens the lineage graph into a conserved set of recipient legs).
 * This contract settles that distribution atomically on Arc: it pulls the total
 * from the payer and pays each leg, so a remix of a remix pays every ancestor in
 * a single, gas-bounded settlement. Sub-cent legs are economical because the
 * whole lineage clears in one transfer-in plus N transfer-outs.
 */
contract RecursiveSplitDistributor {
    /// Settlement token (USDC), fixed at deployment.
    IERC20 public immutable token;

    event SplitDistributed(bytes32 indexed id, address indexed payer, uint256 total, uint256 legs);
    event LegPaid(bytes32 indexed id, address indexed recipient, uint256 amount);

    error LengthMismatch();
    error EmptyDistribution();
    error ZeroTotal();
    error TransferFailed();

    constructor(IERC20 _token) {
        token = _token;
    }

    /**
     * Settle a precomputed lineage distribution. `recipients[i]` receives
     * `amounts[i]`; the payer must have approved at least the sum to this
     * contract. The pull happens before any payout (checks-effects-interactions).
     *
     * @param id          Caller-supplied settlement id (e.g. the access/citation id).
     * @param recipients  Author/ancestor wallets, in lineage order.
     * @param amounts     Per-recipient amounts (must align with `recipients`).
     */
    function distribute(
        bytes32 id,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        if (recipients.length != amounts.length) revert LengthMismatch();
        if (recipients.length == 0) revert EmptyDistribution();

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        if (total == 0) revert ZeroTotal();

        // Pull the whole distribution from the payer first.
        if (!token.transferFrom(msg.sender, address(this), total)) revert TransferFailed();

        // Fan out to each recipient.
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 amount = amounts[i];
            if (amount == 0) continue;
            if (!token.transfer(recipients[i], amount)) revert TransferFailed();
            emit LegPaid(id, recipients[i], amount);
        }

        emit SplitDistributed(id, msg.sender, total, recipients.length);
    }
}
