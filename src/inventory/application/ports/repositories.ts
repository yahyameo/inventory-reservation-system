import { Product } from '../../domain/product';
import { Reservation } from '../../domain/reservation';

/**
 * Repositories hand out fresh domain objects on every read. Mutating an
 * object has no effect until it is passed back to `save`.
 */
export interface ProductRepository {
  findById(productId: string): Promise<Product | null>;
  save(product: Product): Promise<void>;
}

export interface ReservationRepository {
  findById(reservationId: string): Promise<Reservation | null>;
  save(reservation: Reservation): Promise<void>;
  /** ACTIVE reservations of one product whose hold has elapsed at `now`. */
  findDueForExpiry(productId: string, now: Date): Promise<Reservation[]>;
  /** Ids of products that have at least one ACTIVE reservation whose hold has elapsed. */
  findProductIdsWithDueReservations(now: Date): Promise<string[]>;
}

export interface Repositories {
  readonly products: ProductRepository;
  readonly reservations: ReservationRepository;
}
