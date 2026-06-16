// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * SettleKitEscrow — trustless USDC escrow on Arc.
 *
 * The on-chain counterpart to the off-chain SettleKit escrow product (the
 * "settlekit/escrow" package): a buyer funds an escrow for a seller with a
 * neutral arbiter. Funds release to the
 * seller (by the buyer or the arbiter), refund to the buyer (by the seller or
 * the arbiter), and either party may raise a dispute that only the arbiter can
 * resolve. Single fungible token (USDC), set at deploy time.
 *
 * Safety: checks-effects-interactions ordering (state is finalized before the
 * token transfer), so a malicious token cannot re-enter into a second payout.
 */
contract SettleKitEscrow {
    enum State {
        None,
        Funded,
        Disputed,
        Released,
        Refunded
    }

    struct Escrow {
        address buyer;
        address seller;
        address arbiter;
        uint256 amount;
        State state;
    }

    /// The settlement token (USDC), fixed at deployment.
    IERC20 public immutable token;

    /// Escrows keyed by a caller-supplied id.
    mapping(bytes32 => Escrow) private _escrows;

    event EscrowFunded(
        bytes32 indexed id,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        uint256 amount
    );
    event EscrowReleased(bytes32 indexed id, address indexed seller, uint256 amount);
    event EscrowRefunded(bytes32 indexed id, address indexed buyer, uint256 amount);
    event EscrowDisputed(bytes32 indexed id, address indexed by);

    error AlreadyExists();
    error NotFound();
    error NotFundedOrDisputed();
    error NotAuthorized();
    error InvalidParticipants();
    error ZeroAmount();
    error TransferFailed();

    constructor(IERC20 token_) {
        require(address(token_) != address(0), "token=0");
        token = token_;
    }

    /** Read an escrow. */
    function escrows(bytes32 id) external view returns (Escrow memory) {
        return _escrows[id];
    }

    /**
     * Create + fund an escrow. The buyer (msg.sender) must have approved this
     * contract for `amount`. Pulls the funds in immediately.
     */
    function createAndFund(
        bytes32 id,
        address seller,
        address arbiter,
        uint256 amount
    ) external {
        if (_escrows[id].state != State.None) revert AlreadyExists();
        if (seller == address(0) || arbiter == address(0) || seller == msg.sender) {
            revert InvalidParticipants();
        }
        if (amount == 0) revert ZeroAmount();

        _escrows[id] = Escrow({
            buyer: msg.sender,
            seller: seller,
            arbiter: arbiter,
            amount: amount,
            state: State.Funded
        });

        emit EscrowFunded(id, msg.sender, seller, arbiter, amount);

        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /** Release the escrow to the seller. Callable by the buyer or the arbiter. */
    function release(bytes32 id) external {
        Escrow storage e = _escrows[id];
        if (e.state == State.None) revert NotFound();
        if (e.state != State.Funded && e.state != State.Disputed) revert NotFundedOrDisputed();
        if (msg.sender != e.buyer && msg.sender != e.arbiter) revert NotAuthorized();

        e.state = State.Released;
        emit EscrowReleased(id, e.seller, e.amount);
        if (!token.transfer(e.seller, e.amount)) revert TransferFailed();
    }

    /** Refund the escrow to the buyer. Callable by the seller or the arbiter. */
    function refund(bytes32 id) external {
        Escrow storage e = _escrows[id];
        if (e.state == State.None) revert NotFound();
        if (e.state != State.Funded && e.state != State.Disputed) revert NotFundedOrDisputed();
        if (msg.sender != e.seller && msg.sender != e.arbiter) revert NotAuthorized();

        e.state = State.Refunded;
        emit EscrowRefunded(id, e.buyer, e.amount);
        if (!token.transfer(e.buyer, e.amount)) revert TransferFailed();
    }

    /** Raise a dispute; only the buyer or seller may, and only the arbiter resolves it. */
    function dispute(bytes32 id) external {
        Escrow storage e = _escrows[id];
        if (e.state != State.Funded) revert NotFundedOrDisputed();
        if (msg.sender != e.buyer && msg.sender != e.seller) revert NotAuthorized();

        e.state = State.Disputed;
        emit EscrowDisputed(id, msg.sender);
    }
}
