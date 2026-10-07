export interface InventoryOptions {
  /** How long a reservation holds stock before it expires. Spec: 2 minutes. */
  readonly reservationHoldMs: number;
}

export const INVENTORY_OPTIONS = Symbol('INVENTORY_OPTIONS');
