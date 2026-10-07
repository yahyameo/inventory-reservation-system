import {
  InvalidQuantityError,
  InvalidReservationStateError,
  InvariantViolationError,
  ReservationExpiredError,
} from './errors';
import { ALLOWED_TRANSITIONS, ReservationStatus } from './reservation-status';

export interface ReservationSnapshot {
  readonly id: string;
  readonly productId: string;
  readonly userId: string;
  readonly quantity: number;
  readonly status: ReservationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
}

export interface CreateReservationProps {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
  now: Date;
  holdDurationMs: number;
}

/**
 * A temporary hold on stock. All time-dependent methods take `now` explicitly,
 * which keeps the entity pure and deterministic to test.
 *
 * A hold is considered over at `expiresAt` even if nothing has flipped its
 * status to EXPIRED yet. That is why confirm/cancel check the clock: correctness
 * never depends on the background sweeper having run.
 */
export class Reservation {
  private constructor(
    readonly id: string,
    readonly productId: string,
    readonly userId: string,
    readonly quantity: number,
    private currentStatus: ReservationStatus,
    readonly createdAt: Date,
    private lastUpdatedAt: Date,
    readonly expiresAt: Date,
  ) {}

  static create(props: CreateReservationProps): Reservation {
    if (!Number.isInteger(props.quantity) || props.quantity <= 0) {
      throw new InvalidQuantityError('quantity', props.quantity, 'a positive integer');
    }
    const expiresAt = new Date(props.now.getTime() + props.holdDurationMs);
    return new Reservation(
      props.id,
      props.productId,
      props.userId,
      props.quantity,
      ReservationStatus.Active,
      props.now,
      props.now,
      expiresAt,
    );
  }

  static fromSnapshot(snapshot: ReservationSnapshot): Reservation {
    return new Reservation(
      snapshot.id,
      snapshot.productId,
      snapshot.userId,
      snapshot.quantity,
      snapshot.status,
      new Date(snapshot.createdAt),
      new Date(snapshot.updatedAt),
      new Date(snapshot.expiresAt),
    );
  }

  get status(): ReservationStatus {
    return this.currentStatus;
  }

  get updatedAt(): Date {
    return this.lastUpdatedAt;
  }

  /** True when the hold has elapsed but the reservation still holds stock. */
  isDueForExpiry(now: Date): boolean {
    return this.currentStatus === ReservationStatus.Active && now >= this.expiresAt;
  }

  confirm(now: Date): void {
    this.assertCanTransition(ReservationStatus.Confirmed, 'confirm');
    this.assertHoldNotLapsed(now);
    this.transitionTo(ReservationStatus.Confirmed, now);
  }

  cancel(now: Date): void {
    this.assertCanTransition(ReservationStatus.Cancelled, 'cancel');
    this.assertHoldNotLapsed(now);
    this.transitionTo(ReservationStatus.Cancelled, now);
  }

  expire(now: Date): void {
    this.assertCanTransition(ReservationStatus.Expired, 'expire');
    if (now < this.expiresAt) {
      throw new InvariantViolationError(
        `reservation ${this.id} cannot expire before ${this.expiresAt.toISOString()}`,
      );
    }
    this.transitionTo(ReservationStatus.Expired, now);
  }

  toSnapshot(): ReservationSnapshot {
    return {
      id: this.id,
      productId: this.productId,
      userId: this.userId,
      quantity: this.quantity,
      status: this.currentStatus,
      createdAt: this.createdAt,
      updatedAt: this.lastUpdatedAt,
      expiresAt: this.expiresAt,
    };
  }

  private assertHoldNotLapsed(now: Date): void {
    if (this.isDueForExpiry(now)) {
      throw new ReservationExpiredError(this.id);
    }
  }

  private assertCanTransition(next: ReservationStatus, action: string): void {
    if (!ALLOWED_TRANSITIONS[this.currentStatus].includes(next)) {
      throw new InvalidReservationStateError(this.id, this.currentStatus, action);
    }
  }

  private transitionTo(next: ReservationStatus, now: Date): void {
    this.currentStatus = next;
    this.lastUpdatedAt = now;
  }
}
