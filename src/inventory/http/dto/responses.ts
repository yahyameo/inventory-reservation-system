import { ApiProperty } from '@nestjs/swagger';
import { DomainErrorCode } from '../../domain/errors';
import { Product } from '../../domain/product';
import { Reservation } from '../../domain/reservation';
import { ReservationStatus } from '../../domain/reservation-status';

/** Public JSON shapes. They are kept separate from the domain so either can change on its own. */
export class ProductResponse {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'Limited edition sneaker' }) readonly name: string;
  @ApiProperty({ example: 1 }) readonly totalStock: number;
  @ApiProperty({ example: 0, description: 'totalStock - soldQuantity - reservedQuantity' })
  readonly availableStock: number;
  @ApiProperty({ example: 1, description: 'Units held by ACTIVE reservations' })
  readonly reservedQuantity: number;
  @ApiProperty({ example: 0, description: 'Units in CONFIRMED reservations' })
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
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ format: 'uuid' }) readonly productId: string;
  @ApiProperty({ example: 'alice' }) readonly userId: string;
  @ApiProperty({ example: 1 }) readonly quantity: number;
  @ApiProperty({ enum: ReservationStatus, enumName: 'ReservationStatus' })
  readonly status: ReservationStatus;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
  @ApiProperty({ format: 'date-time' }) readonly updatedAt: string;
  @ApiProperty({ format: 'date-time', description: 'When the hold lapses (createdAt + 2 minutes)' })
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

/** Documents the body produced by DomainExceptionFilter. */
export class ErrorResponse {
  @ApiProperty({ example: 409 }) readonly statusCode!: number;
  @ApiProperty({
    example: 'INSUFFICIENT_STOCK',
    enum: [
      'INVALID_QUANTITY',
      'INSUFFICIENT_STOCK',
      'PRODUCT_NOT_FOUND',
      'RESERVATION_NOT_FOUND',
      'INVALID_RESERVATION_STATE',
      'RESERVATION_EXPIRED',
    ] satisfies DomainErrorCode[],
  })
  readonly error!: DomainErrorCode;
  @ApiProperty({ example: 'Cannot reserve 1 unit(s) of product …: only 0 available' })
  readonly message!: string;
}
