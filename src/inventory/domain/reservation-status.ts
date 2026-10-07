export enum ReservationStatus {
  Active = 'ACTIVE',
  Confirmed = 'CONFIRMED',
  Cancelled = 'CANCELLED',
  Expired = 'EXPIRED',
}

/**
 * The only legal transitions. ACTIVE is the sole non-terminal state:
 *
 *   ACTIVE ──confirm──▶ CONFIRMED   (purchase completed, irreversible)
 *     │ ────cancel───▶ CANCELLED   (stock released)
 *     └─────expire───▶ EXPIRED     (stock released)
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<ReservationStatus, readonly ReservationStatus[]>> =
  {
    [ReservationStatus.Active]: [
      ReservationStatus.Confirmed,
      ReservationStatus.Cancelled,
      ReservationStatus.Expired,
    ],
    [ReservationStatus.Confirmed]: [],
    [ReservationStatus.Cancelled]: [],
    [ReservationStatus.Expired]: [],
  };
