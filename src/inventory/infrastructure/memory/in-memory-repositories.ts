import { ProductRepository, ReservationRepository } from '../../application/ports/repositories';
import { Product, ProductSnapshot } from '../../domain/product';
import { Reservation, ReservationSnapshot } from '../../domain/reservation';
import { StagedTable } from './staged-table';

/**
 * The repositories store immutable snapshots rather than live entities, so a
 * caller can never change persisted state by mutating an object it holds.
 * That is the same contract a real database gives.
 */
export class InMemoryProductRepository implements ProductRepository {
  constructor(private readonly table: StagedTable<ProductSnapshot>) {}

  findById(productId: string): Promise<Product | null> {
    const row = this.table.get(productId);
    return Promise.resolve(row ? Product.fromSnapshot(row) : null);
  }

  save(product: Product): Promise<void> {
    this.table.set(product.id, Object.freeze(product.toSnapshot()));
    return Promise.resolve();
  }
}

export class InMemoryReservationRepository implements ReservationRepository {
  constructor(private readonly table: StagedTable<ReservationSnapshot>) {}

  findById(reservationId: string): Promise<Reservation | null> {
    const row = this.table.get(reservationId);
    return Promise.resolve(row ? Reservation.fromSnapshot(row) : null);
  }

  save(reservation: Reservation): Promise<void> {
    this.table.set(reservation.id, Object.freeze(reservation.toSnapshot()));
    return Promise.resolve();
  }

  findDueForExpiry(productId: string, now: Date): Promise<Reservation[]> {
    return Promise.resolve(
      this.dueReservations(now).filter((reservation) => reservation.productId === productId),
    );
  }

  findProductIdsWithDueReservations(now: Date): Promise<string[]> {
    const productIds = new Set(this.dueReservations(now).map((r) => r.productId));
    return Promise.resolve([...productIds]);
  }

  // A linear scan is fine for an in-memory demo store. A production store
  // indexes (status, expiresAt), as the Mongo adapter does.
  private dueReservations(now: Date): Reservation[] {
    const due: Reservation[] = [];
    for (const row of this.table.rows()) {
      const reservation = Reservation.fromSnapshot(row);
      if (reservation.isDueForExpiry(now)) due.push(reservation);
    }
    return due;
  }
}
