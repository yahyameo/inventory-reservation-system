import { Product } from '../../domain/product';
import { Reservation } from '../../domain/reservation';
import { ReservationStatus } from '../../domain/reservation-status';

/** Public JSON shapes. They are kept separate from the domain so either can change on its own. */
export class ProductResponse {
  readonly id: string;
  readonly name: string;
  readonly totalStock: number;
  readonly availableStock: number;
  readonly reservedQuantity: number;
  readonly soldQuantity: number;

  constructor(product: Product) {
    this.id = product.id;
    this.name = product.name;
    this.totalStock = product.totalStock;
    this.availableStock = product.availableStock;
    this.reservedQuantity = product.reservedQuantity;
    this.soldQuantity = product.soldQuantity;
  }
}

export class ReservationResponse {
  readonly id: string;
  readonly productId: string;
  readonly userId: string;
  readonly quantity: number;
  readonly status: ReservationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;

  constructor(reservation: Reservation) {
    this.id = reservation.id;
    this.productId = reservation.productId;
    this.userId = reservation.userId;
    this.quantity = reservation.quantity;
    this.status = reservation.status;
    this.createdAt = reservation.createdAt.toISOString();
    this.updatedAt = reservation.updatedAt.toISOString();
    this.expiresAt = reservation.expiresAt.toISOString();
  }
}
