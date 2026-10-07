import { Inject, Injectable, Logger } from '@nestjs/common';
import { Product } from '../domain/product';
import { CLOCK, Clock } from './ports/clock';
import { Repositories } from './ports/repositories';
import { UNIT_OF_WORK, UnitOfWork } from './ports/unit-of-work';

/**
 * Releases stock held by reservations whose hold has elapsed.
 *
 * Expiry runs on two paths:
 *  - Lazily: every operation on a product first releases that product's lapsed
 *    holds, inside the same unit of work (`releaseDue`). Correctness therefore
 *    never depends on timers.
 *  - Proactively: the background sweeper calls `releaseAllExpired`, so stock
 *    and status are also up to date for products nobody is touching.
 */
@Injectable()
export class ReservationExpiryService {
  private readonly logger = new Logger(ReservationExpiryService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Expires the product's lapsed reservations and returns their stock.
   * Must be called inside `runExclusive` for `product.id`. Persists the
   * reservations and the product, and returns how many were released.
   */
  async releaseDue(repositories: Repositories, product: Product, now: Date): Promise<number> {
    const due = await repositories.reservations.findDueForExpiry(product.id, now);
    for (const reservation of due) {
      reservation.expire(now);
      product.releaseReservation(reservation.quantity);
      await repositories.reservations.save(reservation);
    }
    if (due.length > 0) {
      await repositories.products.save(product);
    }
    return due.length;
  }

  /**
   * Sweeps every product with lapsed holds, each in its own unit of work.
   * A failure on one product is logged and skipped, so it cannot stop stock
   * being released for the others.
   */
  async releaseAllExpired(): Promise<number> {
    const productIds = await this.unitOfWork.read((repositories) =>
      repositories.reservations.findProductIdsWithDueReservations(this.clock.now()),
    );

    let released = 0;
    for (const productId of productIds) {
      try {
        released += await this.releaseExpiredFor(productId);
      } catch (error: unknown) {
        this.logger.error(`Failed to release expired reservations of product ${productId}`, error);
      }
    }
    return released;
  }

  private releaseExpiredFor(productId: string): Promise<number> {
    return this.unitOfWork.runExclusive(productId, async (repositories) => {
      const product = await repositories.products.findById(productId);
      return product ? this.releaseDue(repositories, product, this.clock.now()) : 0;
    });
  }
}
