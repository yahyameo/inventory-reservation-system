import { Repositories } from '../../application/ports/repositories';
import { UnitOfWork } from '../../application/ports/unit-of-work';
import { ProductSnapshot } from '../../domain/product';
import { ReservationSnapshot } from '../../domain/reservation';
import { KeyedMutex } from '../concurrency/keyed-mutex';
import { ProductLock } from '../concurrency/product-lock';
import { InMemoryProductRepository, InMemoryReservationRepository } from './in-memory-repositories';
import { StagedTable } from './staged-table';

/**
 * Pessimistic concurrency control for a single process:
 *  1. take the per-product lock (KeyedMutex): work on the same product is
 *     serialised, while different products run in parallel;
 *  2. run the work against staged tables;
 *  3. commit synchronously only if the work succeeded, otherwise discard.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly products = new Map<string, ProductSnapshot>();
  private readonly reservations = new Map<string, ReservationSnapshot>();

  constructor(private readonly locks: ProductLock = new KeyedMutex()) {}

  runExclusive<T>(productId: string, work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.locks.runExclusive(productId, () => this.runTransaction(work));
  }

  async read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    const { repositories } = this.beginTransaction();
    return work(repositories); // never committed: writes are discarded
  }

  private async runTransaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    const { repositories, commit } = this.beginTransaction();
    const result = await work(repositories);
    commit();
    return result;
  }

  private beginTransaction(): { repositories: Repositories; commit: () => void } {
    const products = new StagedTable(this.products);
    const reservations = new StagedTable(this.reservations);
    return {
      repositories: {
        products: new InMemoryProductRepository(products),
        reservations: new InMemoryReservationRepository(reservations),
      },
      commit: () => {
        products.commit();
        reservations.commit();
      },
    };
  }
}
