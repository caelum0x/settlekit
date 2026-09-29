// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";
import {IYieldAdapter} from "./interfaces/IYieldAdapter.sol";
import {SafeTransfer} from "./libraries/SafeTransfer.sol";

/**
 * OperatorVault — the on-chain guard rails for SettleKit's autonomous business
 * operator on Arc.
 *
 * A human `owner` sets policy; an AI `operator` (the agent's Circle wallet)
 * runs the business inside it. The vault holds USDC and tracks four internal
 * buckets: OPERATING (float for bills), TAX (reserve, never operator-spendable),
 * YIELD (sleeve that may be swept into a USYC adapter), REFUND (customer
 * refunds). Revenue arrives as unallocated inflow and the operator splits it.
 *
 * Operator payments must be to allowlisted payees, at or under the per-tx cap,
 * inside the UTC-day cap, and backed by the bucket balance. Payments above
 * `escalateAbove` are not executed: they reserve the funds, record a Pending
 * escalation and emit `Escalated`; only the owner can approve (execute) or
 * reject it, and it expires after `ESCALATION_TTL`.
 *
 * Every state mutation emits `DecisionAnchored(decisionHash, action)` so the
 * off-chain hash-chained decision log can be verified against the chain.
 *
 * Safety: a reentrancy lock on every mutating entrypoint plus
 * checks-effects-interactions ordering (state is final before any transfer).
 */
contract OperatorVault {
    using SafeTransfer for IERC20;

    enum Bucket {
        OPERATING,
        TAX,
        YIELD,
        REFUND
    }

    enum Status {
        None,
        Pending,
        Approved,
        Rejected,
        Expired
    }

    struct Pending {
        bytes32 decisionHash;
        Bucket bucket;
        address to;
        uint256 amount;
        uint64 createdAt;
        Status status;
    }

    uint256 public constant BUCKET_COUNT = 4;
    uint256 public constant ESCALATION_TTL = 72 hours;

    bytes32 public constant ACTION_ALLOCATE = "ALLOCATE";
    bytes32 public constant ACTION_PAY = "PAY";
    bytes32 public constant ACTION_ESCALATE = "ESCALATE";
    bytes32 public constant ACTION_APPROVE = "APPROVE";
    bytes32 public constant ACTION_REJECT = "REJECT";
    bytes32 public constant ACTION_EXPIRE = "EXPIRE";
    bytes32 public constant ACTION_SWEEP = "SWEEP_TO_YIELD";
    bytes32 public constant ACTION_REDEEM = "REDEEM_FROM_YIELD";
    bytes32 public constant ACTION_OWNER_WITHDRAW = "OWNER_WITHDRAW";
    bytes32 public constant ACTION_SET_CAPS = "SET_CAPS";
    bytes32 public constant ACTION_SET_ALLOWLIST = "SET_ALLOWLIST";
    bytes32 public constant ACTION_SET_OPERATOR = "SET_OPERATOR";
    bytes32 public constant ACTION_SET_OWNER = "SET_OWNER";
    bytes32 public constant ACTION_SET_YIELD = "SET_YIELD_ADAPTER";
    bytes32 public constant ACTION_PAUSE = "PAUSE";
    bytes32 public constant ACTION_UNPAUSE = "UNPAUSE";

    IERC20 public immutable token;
    address public owner;
    address public operator;

    uint256 public perTxCap;
    uint256 public dailyCap;
    uint256 public escalateAbove;

    bool public paused;
    IYieldAdapter public yieldAdapter;
    /// USDC principal currently deployed into the yield adapter.
    uint256 public yieldDeployed;
    /// USDC reserved for Pending escalations (removed from buckets).
    uint256 public pendingReserved;
    uint256 public nextEscalationId = 1;

    uint256[4] private _buckets;
    mapping(address => bool) public allowlisted;
    /// UTC day index (timestamp / 1 days) => operator spend that day.
    mapping(uint256 => uint256) public spentOnDay;
    mapping(uint256 => Pending) private _pending;

    uint256 private _lock = 1;

    event DecisionAnchored(bytes32 indexed decisionHash, bytes32 indexed action);
    event Allocated(bytes32 indexed decisionHash, uint256[4] amounts);
    event Paid(bytes32 indexed decisionHash, Bucket indexed bucket, address indexed to, uint256 amount);
    event Escalated(
        uint256 indexed id, bytes32 indexed decisionHash, Bucket bucket, address indexed to, uint256 amount
    );
    event EscalationResolved(uint256 indexed id, Status status);
    event CapsUpdated(uint256 perTxCap, uint256 dailyCap, uint256 escalateAbove);
    event AllowlistUpdated(address indexed payee, bool allowed);
    event OperatorUpdated(address indexed operator);
    event OwnerUpdated(address indexed owner);
    event YieldAdapterUpdated(address indexed adapter);
    event YieldMoved(bytes32 indexed decisionHash, bool toYield, uint256 amount);
    event Paused(bool paused);

    error NotOwner();
    error NotOperator();
    error IsPaused();
    error Reentrancy();
    error ZeroAddress();
    error ZeroAmount();
    error TaxLocked();
    error NotAllowlisted();
    error PerTxCapExceeded();
    error DailyCapExceeded();
    error InsufficientBucket();
    error OverAllocation();
    error InvalidCaps();
    error YieldDisabled();
    error InsufficientYield();
    error NotPending();
    error EscalationExpired();
    error EscalationNotExpired();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        IERC20 token_,
        address owner_,
        address operator_,
        uint256 perTxCap_,
        uint256 dailyCap_,
        uint256 escalateAbove_
    ) {
        if (address(token_) == address(0) || owner_ == address(0) || operator_ == address(0)) {
            revert ZeroAddress();
        }
        _validateCaps(perTxCap_, dailyCap_, escalateAbove_);
        token = token_;
        owner = owner_;
        operator = operator_;
        perTxCap = perTxCap_;
        dailyCap = dailyCap_;
        escalateAbove = escalateAbove_;
    }

    // ---------------------------------------------------------------- views

    function bucketBalance(Bucket bucket) external view returns (uint256) {
        return _buckets[uint256(bucket)];
    }

    function buckets() external view returns (uint256[4] memory) {
        return _buckets;
    }

    /// USDC held by the vault that has not been assigned to a bucket or reservation.
    function unallocated() public view returns (uint256) {
        uint256 held = token.balanceOf(address(this));
        uint256 accounted = _sumBuckets() + pendingReserved;
        return held > accounted ? held - accounted : 0;
    }

    function escalation(uint256 id) external view returns (Pending memory) {
        return _pending[id];
    }

    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function spentToday() external view returns (uint256) {
        return spentOnDay[currentDay()];
    }

    // ------------------------------------------------------------- operator

    /** Split unallocated inflow into the four buckets. */
    function allocate(bytes32 decisionHash, uint256[4] calldata amounts)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
    {
        uint256 total = amounts[0] + amounts[1] + amounts[2] + amounts[3];
        if (total == 0) revert ZeroAmount();
        if (total > unallocated()) revert OverAllocation();
        for (uint256 i = 0; i < BUCKET_COUNT; i++) {
            _buckets[i] += amounts[i];
        }
        emit Allocated(decisionHash, amounts);
        emit DecisionAnchored(decisionHash, ACTION_ALLOCATE);
    }

    /**
     * Pay `amount` from `bucket` to `to`. Returns 0 when paid immediately, or
     * the escalation id when the amount is above `escalateAbove`.
     * Check order (mirrored off-chain by the settlekit operator policy):
     * TAX lock, zero amount, allowlist, per-tx cap, bucket balance, then
     * escalate-above, then the UTC daily cap.
     */
    function pay(bytes32 decisionHash, Bucket bucket, address to, uint256 amount)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 escalationId)
    {
        if (bucket == Bucket.TAX) revert TaxLocked();
        if (amount == 0) revert ZeroAmount();
        if (!allowlisted[to]) revert NotAllowlisted();
        if (amount > perTxCap) revert PerTxCapExceeded();
        if (amount > _buckets[uint256(bucket)]) revert InsufficientBucket();

        if (amount > escalateAbove) {
            return _escalate(decisionHash, bucket, to, amount);
        }

        uint256 day = currentDay();
        if (spentOnDay[day] + amount > dailyCap) revert DailyCapExceeded();

        _buckets[uint256(bucket)] -= amount;
        spentOnDay[day] += amount;
        emit Paid(decisionHash, bucket, to, amount);
        emit DecisionAnchored(decisionHash, ACTION_PAY);
        token.safeTransfer(to, amount);
        return 0;
    }

    /** Move `amount` of the YIELD bucket into the yield adapter. */
    function sweepToYield(bytes32 decisionHash, uint256 amount)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
    {
        IYieldAdapter adapter = yieldAdapter;
        if (address(adapter) == address(0)) revert YieldDisabled();
        if (amount == 0) revert ZeroAmount();
        if (amount > _buckets[uint256(Bucket.YIELD)]) revert InsufficientBucket();

        _buckets[uint256(Bucket.YIELD)] -= amount;
        yieldDeployed += amount;
        emit YieldMoved(decisionHash, true, amount);
        emit DecisionAnchored(decisionHash, ACTION_SWEEP);
        token.safeTransfer(address(adapter), amount);
        adapter.deposit(amount);
    }

    /** Redeem `amount` principal from the yield adapter back into the YIELD bucket. */
    function redeemFromYield(bytes32 decisionHash, uint256 amount)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
    {
        IYieldAdapter adapter = yieldAdapter;
        if (address(adapter) == address(0)) revert YieldDisabled();
        if (amount == 0) revert ZeroAmount();
        if (amount > yieldDeployed) revert InsufficientYield();

        yieldDeployed -= amount;
        uint256 before = token.balanceOf(address(this));
        adapter.redeem(amount, address(this));
        uint256 received = token.balanceOf(address(this)) - before;
        _buckets[uint256(Bucket.YIELD)] += received;
        emit YieldMoved(decisionHash, false, received);
        emit DecisionAnchored(decisionHash, ACTION_REDEEM);
    }

    // ---------------------------------------------------------- escalations

    /** Owner approves a Pending escalation; the payment executes now. */
    function approve(uint256 id) external onlyOwner whenNotPaused nonReentrant {
        Pending storage p = _pending[id];
        if (p.status != Status.Pending) revert NotPending();
        if (block.timestamp > uint256(p.createdAt) + ESCALATION_TTL) revert EscalationExpired();
        if (!allowlisted[p.to]) revert NotAllowlisted();

        p.status = Status.Approved;
        pendingReserved -= p.amount;
        spentOnDay[currentDay()] += p.amount;
        emit EscalationResolved(id, Status.Approved);
        emit Paid(p.decisionHash, p.bucket, p.to, p.amount);
        emit DecisionAnchored(p.decisionHash, ACTION_APPROVE);
        token.safeTransfer(p.to, p.amount);
    }

    /** Owner rejects a Pending escalation; the reservation returns to its bucket. */
    function reject(uint256 id) external onlyOwner nonReentrant {
        _release(id, Status.Rejected, ACTION_REJECT);
    }

    /** Anyone may expire a Pending escalation older than ESCALATION_TTL. */
    function expire(uint256 id) external nonReentrant {
        Pending storage p = _pending[id];
        if (p.status != Status.Pending) revert NotPending();
        if (block.timestamp <= uint256(p.createdAt) + ESCALATION_TTL) revert EscalationNotExpired();
        _release(id, Status.Expired, ACTION_EXPIRE);
    }

    // ---------------------------------------------------------------- owner

    /** Owner withdraws from any bucket (including TAX) to any address. */
    function ownerWithdraw(bytes32 decisionHash, Bucket bucket, address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > _buckets[uint256(bucket)]) revert InsufficientBucket();
        _buckets[uint256(bucket)] -= amount;
        emit Paid(decisionHash, bucket, to, amount);
        emit DecisionAnchored(decisionHash, ACTION_OWNER_WITHDRAW);
        token.safeTransfer(to, amount);
    }

    function setCaps(bytes32 decisionHash, uint256 perTxCap_, uint256 dailyCap_, uint256 escalateAbove_)
        external
        onlyOwner
    {
        _validateCaps(perTxCap_, dailyCap_, escalateAbove_);
        perTxCap = perTxCap_;
        dailyCap = dailyCap_;
        escalateAbove = escalateAbove_;
        emit CapsUpdated(perTxCap_, dailyCap_, escalateAbove_);
        emit DecisionAnchored(decisionHash, ACTION_SET_CAPS);
    }

    function setAllowlist(bytes32 decisionHash, address payee, bool allowed) external onlyOwner {
        if (payee == address(0)) revert ZeroAddress();
        allowlisted[payee] = allowed;
        emit AllowlistUpdated(payee, allowed);
        emit DecisionAnchored(decisionHash, ACTION_SET_ALLOWLIST);
    }

    function setOperator(bytes32 decisionHash, address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorUpdated(operator_);
        emit DecisionAnchored(decisionHash, ACTION_SET_OPERATOR);
    }

    function transferOwnership(bytes32 decisionHash, address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerUpdated(owner_);
        emit DecisionAnchored(decisionHash, ACTION_SET_OWNER);
    }

    /** Set (or clear with address(0)) the yield adapter. Clearing requires no deployed principal. */
    function setYieldAdapter(bytes32 decisionHash, IYieldAdapter adapter) external onlyOwner {
        if (address(adapter) == address(0) && yieldDeployed != 0) revert InsufficientYield();
        yieldAdapter = adapter;
        emit YieldAdapterUpdated(address(adapter));
        emit DecisionAnchored(decisionHash, ACTION_SET_YIELD);
    }

    /** Kill switch: halts allocate, pay, yield moves and approvals. */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
        emit DecisionAnchored(bytes32(0), ACTION_PAUSE);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
        emit DecisionAnchored(bytes32(0), ACTION_UNPAUSE);
    }

    // ------------------------------------------------------------- internal

    function _escalate(bytes32 decisionHash, Bucket bucket, address to, uint256 amount)
        private
        returns (uint256 id)
    {
        id = nextEscalationId++;
        _buckets[uint256(bucket)] -= amount;
        pendingReserved += amount;
        _pending[id] = Pending({
            decisionHash: decisionHash,
            bucket: bucket,
            to: to,
            amount: amount,
            createdAt: uint64(block.timestamp),
            status: Status.Pending
        });
        emit Escalated(id, decisionHash, bucket, to, amount);
        emit DecisionAnchored(decisionHash, ACTION_ESCALATE);
    }

    function _release(uint256 id, Status status, bytes32 action) private {
        Pending storage p = _pending[id];
        if (p.status != Status.Pending) revert NotPending();
        p.status = status;
        pendingReserved -= p.amount;
        _buckets[uint256(p.bucket)] += p.amount;
        emit EscalationResolved(id, status);
        emit DecisionAnchored(p.decisionHash, action);
    }

    function _sumBuckets() private view returns (uint256 total) {
        for (uint256 i = 0; i < BUCKET_COUNT; i++) {
            total += _buckets[i];
        }
    }

    function _validateCaps(uint256 perTxCap_, uint256 dailyCap_, uint256 escalateAbove_) private pure {
        if (perTxCap_ == 0 || dailyCap_ < perTxCap_ || escalateAbove_ > perTxCap_) revert InvalidCaps();
    }
}
