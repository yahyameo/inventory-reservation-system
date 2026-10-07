import { ReservationStatus } from '../../domain/reservation-status';

export interface ProductDocument {
  _id: string;
  name: string;
  totalStock: number;
  reservedQuantity: number;
  soldQuantity: number;
}

export interface ReservationDocument {
  _id: string;
  productId: string;
  userId: string;
  quantity: number;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export const PRODUCTS_COLLECTION = 'products';
export const RESERVATIONS_COLLECTION = 'reservations';
