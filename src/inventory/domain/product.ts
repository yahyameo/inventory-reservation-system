import { InsufficientStockError, InvalidQuantityError, InvariantViolationError } from './errors';

export interface ProductSnapshot {
  readonly id: string;
  readonly name: string;
  readonly totalStock: number;
  readonly reservedQuantity: number;
  readonly soldQuantity: number;
}

/**
 * Aggregate root for a product's stock ledger.
 *
 *   available = total - sold - reserved
 *
 * Stock only ever moves along three paths:
 *   available --reserve-->        reserved
 *   reserved  --release-->        available   (cancel / expiry)
 *   reserved  --confirmSale-->    sold        (irreversible)
 *
 * Every method validates before mutating, so a rejected call never leaves the
 * aggregate half-updated.
 */
export class Product {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly totalStock: number,
    private reserved: number,
    private sold: number,
  ) {}

  static create(props: { id: string; name: string; totalStock: number }): Product {
    assertNonNegativeInteger('totalStock', props.totalStock);
    return new Product(props.id, props.name, props.totalStock, 0, 0);
  }

  static fromSnapshot(snapshot: ProductSnapshot): Product {
    return new Product(
      snapshot.id,
      snapshot.name,
      snapshot.totalStock,
      snapshot.reservedQuantity,
      snapshot.soldQuantity,
    );
  }

  get reservedQuantity(): number {
    return this.reserved;
  }

  get soldQuantity(): number {
    return this.sold;
  }

  get availableStock(): number {
    return this.totalStock - this.sold - this.reserved;
  }

  reserve(quantity: number): void {
    assertPositiveInteger('quantity', quantity);
    if (quantity > this.availableStock) {
      throw new InsufficientStockError(this.id, quantity, this.availableStock);
    }
    this.reserved += quantity;
  }

  releaseReservation(quantity: number): void {
    assertPositiveInteger('quantity', quantity);
    this.assertReservedAtLeast(quantity, 'release');
    this.reserved -= quantity;
  }

  confirmSale(quantity: number): void {
    assertPositiveInteger('quantity', quantity);
    this.assertReservedAtLeast(quantity, 'sell');
    this.reserved -= quantity;
    this.sold += quantity;
  }

  toSnapshot(): ProductSnapshot {
    return {
      id: this.id,
      name: this.name,
      totalStock: this.totalStock,
      reservedQuantity: this.reserved,
      soldQuantity: this.sold,
    };
  }

  private assertReservedAtLeast(quantity: number, action: string): void {
    if (quantity > this.reserved) {
      throw new InvariantViolationError(
        `cannot ${action} ${quantity} unit(s) of product ${this.id}; only ${this.reserved} reserved`,
      );
    }
  }
}

function assertNonNegativeInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidQuantityError(field, value, 'a non-negative integer');
  }
}

function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidQuantityError(field, value, 'a positive integer');
  }
}
