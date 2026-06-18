// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * AgentReputationBond — reputation you post as collateral, not a score you ask
 * to be trusted (RFB 3, ERC-8004-style).
 *
 * A broker agent posts a USDC bond to stand behind a match it routed to a
 * client. If the provider underdelivers, the bond slashes to the client when the
 * outcome resolves; if the introduction was good, the bond releases back to the
 * broker. A neutral arbiter can resolve either way. Reputation becomes capital
 * at risk — far harder to fake than a number — and resolves in one transfer.
 */
contract AgentReputationBond {
    IERC20 public immutable token;

    enum State {
        None,
        Posted,
        Released,
        Slashed
    }

    struct Bond {
        address broker;
        address client;
        address arbiter;
        uint256 amount;
        State state;
    }

    mapping(bytes32 => Bond) private _bonds;

    event BondPosted(bytes32 indexed id, address indexed broker, address indexed client, address arbiter, uint256 amount);
    event BondReleased(bytes32 indexed id, address indexed broker, uint256 amount);
    event BondSlashed(bytes32 indexed id, address indexed client, uint256 amount);

    error AlreadyExists();
    error NotFound();
    error NotAuthorized();
    error ZeroAmount();
    error InvalidParticipants();
    error TransferFailed();

    constructor(IERC20 _token) {
        token = _token;
    }

    /** Broker posts a bond backing a match for `client`, with a neutral `arbiter`. */
    function post(bytes32 id, address client, address arbiter, uint256 amount) external {
        if (_bonds[id].state != State.None) revert AlreadyExists();
        if (amount == 0) revert ZeroAmount();
        if (client == address(0) || arbiter == address(0) || client == msg.sender) {
            revert InvalidParticipants();
        }
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        _bonds[id] = Bond({
            broker: msg.sender,
            client: client,
            arbiter: arbiter,
            amount: amount,
            state: State.Posted
        });
        emit BondPosted(id, msg.sender, client, arbiter, amount);
    }

    /** Good outcome: return the bond to the broker. Client or arbiter may call. */
    function release(bytes32 id) external {
        Bond storage b = _bonds[id];
        if (b.state != State.Posted) revert NotFound();
        if (msg.sender != b.client && msg.sender != b.arbiter) revert NotAuthorized();
        b.state = State.Released;
        address broker = b.broker;
        uint256 amount = b.amount;
        if (!token.transfer(broker, amount)) revert TransferFailed();
        emit BondReleased(id, broker, amount);
    }

    /** Bad outcome: slash the bond to the client. Broker or arbiter may call. */
    function slash(bytes32 id) external {
        Bond storage b = _bonds[id];
        if (b.state != State.Posted) revert NotFound();
        if (msg.sender != b.broker && msg.sender != b.arbiter) revert NotAuthorized();
        b.state = State.Slashed;
        address client = b.client;
        uint256 amount = b.amount;
        if (!token.transfer(client, amount)) revert TransferFailed();
        emit BondSlashed(id, client, amount);
    }

    /** Read a bond's current state and terms. */
    function bondOf(bytes32 id)
        external
        view
        returns (address broker, address client, address arbiter, uint256 amount, State state)
    {
        Bond storage b = _bonds[id];
        return (b.broker, b.client, b.arbiter, b.amount, b.state);
    }
}
