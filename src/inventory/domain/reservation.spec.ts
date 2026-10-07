import {
  InvalidQuantityError,
  InvalidReservationStateError,
  InvariantViolationError,
  ReservationExpiredError,
} from './errors';
import { Reservation } from './reservation';
import { ReservationStatus } from './reservation-status';

const HOLD_MS = 2 * 60 * 1000;
const T0 = new Date('2026-01-01T10:00:00.000Z');
const at = (msAfterT0: number) => new Date(T0.getTime() + msAfterT0);

const newReservation = (quantity = 1) =>
  Reservation.create({
    id: 'r-1',
    productId: 'p-1',
    userId: 'user-a',
    quantity,
    now: T0,
    holdDurationMs: HOLD_MS,
  });

describe('Reservation', () => {
  describe('create', () => {
    it('starts ACTIVE and holds stock for the configured duration', () => {
      const reservation = newReservation();

      expect(reservation.status).toBe(ReservationStatus.Active);
      expect(reservation.createdAt).toEqual(T0);
      expect(reservation.expiresAt).toEqual(at(HOLD_MS));
    });

    it.each([0, -2, 1.5])('rejects an invalid quantity of %p', (quantity) => {
      expect(() => newReservation(quantity)).toThrow(InvalidQuantityError);
    });
  });

  describe('isDueForExpiry', () => {
    it('is false while the hold is still running', () => {
      expect(newReservation().isDueForExpiry(at(HOLD_MS - 1))).toBe(false);
    });

    it('is true from the exact expiry instant onwards', () => {
      expect(newReservation().isDueForExpiry(at(HOLD_MS))).toBe(true);
    });

    it('is false once the reservation has left the ACTIVE state', () => {
      const reservation = newReservation();
      reservation.confirm(at(1_000));

      expect(reservation.isDueForExpiry(at(HOLD_MS * 10))).toBe(false);
    });
  });

  describe('confirm', () => {
    it('moves an ACTIVE reservation to CONFIRMED', () => {
      const reservation = newReservation();

      reservation.confirm(at(HOLD_MS - 1));

      expect(reservation.status).toBe(ReservationStatus.Confirmed);
      expect(reservation.updatedAt).toEqual(at(HOLD_MS - 1));
    });

    it('fails once the hold has elapsed, even if nothing has expired it yet', () => {
      const reservation = newReservation();

      expect(() => reservation.confirm(at(HOLD_MS))).toThrow(ReservationExpiredError);
      expect(reservation.status).toBe(ReservationStatus.Active);
    });

    it('cannot confirm twice', () => {
      const reservation = newReservation();
      reservation.confirm(at(1));

      expect(() => reservation.confirm(at(2))).toThrow(InvalidReservationStateError);
    });
  });

  describe('cancel', () => {
    it('moves an ACTIVE reservation to CANCELLED', () => {
      const reservation = newReservation();

      reservation.cancel(at(10));

      expect(reservation.status).toBe(ReservationStatus.Cancelled);
    });

    it('cannot reverse a confirmed purchase', () => {
      const reservation = newReservation();
      reservation.confirm(at(1));

      expect(() => reservation.cancel(at(2))).toThrow(InvalidReservationStateError);
      expect(reservation.status).toBe(ReservationStatus.Confirmed);
    });

    it('fails once the hold has elapsed', () => {
      expect(() => newReservation().cancel(at(HOLD_MS))).toThrow(ReservationExpiredError);
    });
  });

  describe('expire', () => {
    it('moves a due ACTIVE reservation to EXPIRED', () => {
      const reservation = newReservation();

      reservation.expire(at(HOLD_MS));

      expect(reservation.status).toBe(ReservationStatus.Expired);
    });

    it('refuses to expire a reservation before its hold has elapsed', () => {
      expect(() => newReservation().expire(at(HOLD_MS - 1))).toThrow(InvariantViolationError);
    });

    it('cannot expire a cancelled reservation', () => {
      const reservation = newReservation();
      reservation.cancel(at(1));

      expect(() => reservation.expire(at(HOLD_MS))).toThrow(InvalidReservationStateError);
    });
  });

  describe('once EXPIRED (terminal)', () => {
    const expired = () => {
      const reservation = newReservation();
      reservation.expire(at(HOLD_MS));
      return reservation;
    };

    it('confirm reports the reservation as expired', () => {
      expect(() => expired().confirm(at(HOLD_MS + 1))).toThrow(ReservationExpiredError);
    });

    it('cancel reports the reservation as expired', () => {
      expect(() => expired().cancel(at(HOLD_MS + 1))).toThrow(ReservationExpiredError);
    });

    it('cannot be expired again', () => {
      expect(() => expired().expire(at(HOLD_MS + 1))).toThrow(InvalidReservationStateError);
    });
  });

  it('round-trips through a snapshot', () => {
    const reservation = newReservation(3);
    reservation.confirm(at(5));

    const restored = Reservation.fromSnapshot(reservation.toSnapshot());

    expect(restored.toSnapshot()).toEqual(reservation.toSnapshot());
  });
});
