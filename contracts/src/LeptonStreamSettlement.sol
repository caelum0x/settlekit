// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * LeptonStreamSettlement — pay for the rate of flow, by the second (RFB 4).
 *
 * A viewer opens a stream authorizing a per-second rate and depositing a reserve
 * (the maximum they commit). Value accrues to the payee in real time while the
 * stream is active; a delivery drop pauses the meter (proof-of-flow), so paused
 * time is never billed. On close, the watched time settles to the payee and the
 * reserved-but-unused remainder refunds to the payer. Accrual is capped at the
 * reserve. On-chain time is `block.timestamp`.
 */
contract LeptonStreamSettlement {
    IERC20 public immutable token;

    struct Stream {
        address payer;
        address payee;
        uint256 ratePerSecond;
        uint256 reserve;
        uint256 accrued; // total accrued so far (capped at reserve)
        uint256 settled; // total already paid to payee
        uint64 lastTick;
        bool active; // metering (false = paused)
        bool open; // exists and not yet closed
    }

    mapping(bytes32 => Stream) private _streams;

    event StreamOpened(bytes32 indexed id, address indexed payer, address indexed payee, uint256 ratePerSecond, uint256 reserve);
    event StreamSettled(bytes32 indexed id, uint256 amount, uint256 settledTotal);
    event StreamPaused(bytes32 indexed id);
    event StreamResumed(bytes32 indexed id);
    event StreamClosed(bytes32 indexed id, uint256 settledTotal, uint256 refund);

    error AlreadyExists();
    error NotFound();
    error NotPayer();
    error NotParty();
    error ZeroRate();
    error ZeroReserve();
    error InvalidPayee();
    error TransferFailed();

    constructor(IERC20 _token) {
        token = _token;
    }

    /** Open a stream, depositing `reserve` from the caller (the payer). */
    function open(bytes32 id, address payee, uint256 ratePerSecond, uint256 reserve) external {
        if (_streams[id].open) revert AlreadyExists();
        // A zero payee would lock funds: once any value accrues, settle()/close()
        // revert on the transfer to address(0), and close() pays the payee before
        // refunding the payer — so the reserve can never be recovered.
        if (payee == address(0) || payee == msg.sender) revert InvalidPayee();
        if (ratePerSecond == 0) revert ZeroRate();
        if (reserve == 0) revert ZeroReserve();
        if (!token.transferFrom(msg.sender, address(this), reserve)) revert TransferFailed();

        _streams[id] = Stream({
            payer: msg.sender,
            payee: payee,
            ratePerSecond: ratePerSecond,
            reserve: reserve,
            accrued: 0,
            settled: 0,
            lastTick: uint64(block.timestamp),
            active: true,
            open: true
        });
        emit StreamOpened(id, msg.sender, payee, ratePerSecond, reserve);
    }

    /** Total value accrued so far (view; does not mutate). */
    function accrued(bytes32 id) external view returns (uint256) {
        Stream storage s = _streams[id];
        if (!s.open) revert NotFound();
        return _previewAccrued(s);
    }

    /** Reserved-but-unused remainder (refundable on close). */
    function refundable(bytes32 id) external view returns (uint256) {
        Stream storage s = _streams[id];
        if (!s.open) revert NotFound();
        return s.reserve - _previewAccrued(s);
    }

    /** Settle accrued-but-unsettled value to the payee. Either party may call. */
    function settle(bytes32 id) public returns (uint256 paid) {
        Stream storage s = _streams[id];
        if (!s.open) revert NotFound();
        if (msg.sender != s.payer && msg.sender != s.payee) revert NotParty();
        _advance(s);
        paid = s.accrued - s.settled;
        if (paid > 0) {
            s.settled = s.accrued;
            if (!token.transfer(s.payee, paid)) revert TransferFailed();
            emit StreamSettled(id, paid, s.settled);
        }
    }

    /** Pause the meter (proof-of-flow: delivery dropped). Either party. */
    function pause(bytes32 id) external {
        Stream storage s = _streams[id];
        if (!s.open) revert NotFound();
        if (msg.sender != s.payer && msg.sender != s.payee) revert NotParty();
        if (s.active) {
            _advance(s);
            s.active = false;
            emit StreamPaused(id);
        }
    }

    /** Resume a paused meter. Either party. */
    function resume(bytes32 id) external {
        Stream storage s = _streams[id];
        if (!s.open) revert NotFound();
        if (msg.sender != s.payer && msg.sender != s.payee) revert NotParty();
        if (!s.active) {
            s.lastTick = uint64(block.timestamp);
            s.active = true;
            emit StreamResumed(id);
        }
    }

    /** Close the stream: settle the tail to the payee, refund the rest to the
     * payer. Only the payer may close. */
    function close(bytes32 id) external returns (uint256 settledTotal, uint256 refund) {
        Stream storage s = _streams[id];
        if (!s.open) revert NotFound();
        if (msg.sender != s.payer) revert NotPayer();

        _advance(s);
        uint256 tail = s.accrued - s.settled;
        if (tail > 0) {
            s.settled = s.accrued;
            if (!token.transfer(s.payee, tail)) revert TransferFailed();
        }
        refund = s.reserve - s.accrued;
        settledTotal = s.settled;
        address payer = s.payer;
        s.open = false;
        s.active = false;
        if (refund > 0) {
            if (!token.transfer(payer, refund)) revert TransferFailed();
        }
        emit StreamClosed(id, settledTotal, refund);
    }

    // --- internals -------------------------------------------------------

    function _previewAccrued(Stream storage s) private view returns (uint256) {
        if (!s.active) return s.accrued;
        uint256 add = (block.timestamp - s.lastTick) * s.ratePerSecond;
        uint256 headroom = s.reserve - s.accrued;
        if (add > headroom) add = headroom;
        return s.accrued + add;
    }

    function _advance(Stream storage s) private {
        if (!s.active) return;
        uint256 next = _previewAccrued(s);
        s.accrued = next;
        s.lastTick = uint64(block.timestamp);
    }
}
