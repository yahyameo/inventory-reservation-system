/**
 * Errors raised by the domain when a business rule rejects a request.
 * They are expected outcomes (not bugs) and the HTTP layer maps each `code`
 * to a status code. Anything that is not a DomainError is treated as a 500.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidQuantityError extends DomainError {
  readonly code = 'INVALID_QUANTITY';

  constructor(field: string, value: number, requirement: string) {
    super(`${field} must be ${requirement}, got ${value}`);
  }
}

export class InsufficientStockError extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';

  constructor(
    readonly productId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Cannot reserve ${requested} unit(s) of product ${productId}: only ${available} available`,
    );
  }
}

export class ProductNotFoundError extends DomainError {
  readonly code = 'PRODUCT_NOT_FOUND';

  constructor(productId: string) {
    super(`Product ${productId} not found`);
  }
}

export class ReservationNotFoundError extends DomainError {
  readonly code = 'RESERVATION_NOT_FOUND';

  constructor(reservationId: string) {
    super(`Reservation ${reservationId} not found`);
  }
}

export class InvalidReservationStateError extends DomainError {
  readonly code = 'INVALID_RESERVATION_STATE';

  constructor(reservationId: string, currentStatus: string, attemptedAction: string) {
    super(`Cannot ${attemptedAction} reservation ${reservationId}: it is ${currentStatus}`);
  }
}

export class ReservationExpiredError extends DomainError {
  readonly code = 'RESERVATION_EXPIRED';

  constructor(reservationId: string) {
    super(`Reservation ${reservationId} has expired and its stock was released`);
  }
}

/**
 * Raised when an internal invariant would be broken. This always indicates a
 * programming error, so it deliberately does NOT extend DomainError.
 */
export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(`Invariant violated: ${message}`);
    this.name = 'InvariantViolationError';
  }
}
