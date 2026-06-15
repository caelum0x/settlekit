/**
 * Seat management with immutable add/remove and seat-limit enforcement
 * (plan §4, §20).
 *
 * {@link SeatManager} wraps a list of {@link Seat} assignments and a `seatLimit`.
 * Every mutation returns a NEW manager; the original is never modified.
 */
import { conflict, validationError, ok, err, SettleKitError } from "@settlekit/common";
import type { Result } from "@settlekit/common";

/** A single occupied seat. */
export interface Seat {
  userId: string;
  assignedAt: string;
}

/** Internal immutable state of a {@link SeatManager}. */
export interface SeatState {
  seatLimit: number;
  seats: readonly Seat[];
}

/**
 * Immutable seat book-keeper. Construct with a limit and (optionally) existing
 * seats; `addSeat`/`removeSeat` return new instances.
 */
export class SeatManager {
  readonly seatLimit: number;
  readonly seats: readonly Seat[];

  constructor(state: SeatState) {
    if (!Number.isInteger(state.seatLimit) || state.seatLimit < 0) {
      throw new RangeError(`seatLimit must be a non-negative integer, got ${state.seatLimit}`);
    }
    this.seatLimit = state.seatLimit;
    // Defensive copy so external mutation of the source array cannot leak in.
    this.seats = state.seats.map((s) => ({ ...s }));
  }

  /** Number of seats currently occupied. */
  get used(): number {
    return this.seats.length;
  }

  /** Number of seats still available before hitting the limit. */
  get available(): number {
    return Math.max(0, this.seatLimit - this.used);
  }

  /** Whether `userId` already occupies a seat. */
  has(userId: string): boolean {
    return this.seats.some((s) => s.userId === userId);
  }

  /**
   * Add a seat for `userId`. Returns a NEW manager on success.
   * Fails with `conflict` if the user already has a seat, or `validation_error`
   * (status 402 semantics handled by the caller) when the limit is reached.
   */
  addSeat(userId: string, now: Date = new Date()): Result<SeatManager, SettleKitError> {
    if (userId.trim().length === 0) {
      return err(validationError("userId must not be empty"));
    }
    if (this.has(userId)) {
      return err(conflict(`Seat already assigned to ${userId}`, { userId }));
    }
    if (this.available <= 0) {
      return err(
        new SettleKitError({
          code: "payment_required",
          message: `Seat limit reached (${this.seatLimit}); upgrade plan to add seats`,
          details: { seatLimit: this.seatLimit, used: this.used },
        }),
      );
    }
    return ok(
      new SeatManager({
        seatLimit: this.seatLimit,
        seats: [...this.seats, { userId, assignedAt: now.toISOString() }],
      }),
    );
  }

  /**
   * Remove the seat held by `userId`. Returns a NEW manager.
   * Fails with `not_found`-style validation when the user holds no seat.
   */
  removeSeat(userId: string): Result<SeatManager, SettleKitError> {
    if (!this.has(userId)) {
      return err(validationError(`No seat assigned to ${userId}`, { userId }));
    }
    return ok(
      new SeatManager({
        seatLimit: this.seatLimit,
        seats: this.seats.filter((s) => s.userId !== userId),
      }),
    );
  }

  /** Return a defensive copy of the current seats (newest last). */
  listSeats(): Seat[] {
    return this.seats.map((s) => ({ ...s }));
  }
}
