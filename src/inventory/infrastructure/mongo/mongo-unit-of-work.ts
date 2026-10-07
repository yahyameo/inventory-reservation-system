import { ClientSession, Db, MongoClient, TransactionOptions } from 'mongodb';
import { Repositories } from '../../application/ports/repositories';
import { UnitOfWork } from '../../application/ports/unit-of-work';
import { KeyedMutex } from '../concurrency/keyed-mutex';
import { ProductLock } from '../concurrency/product-lock';
import {
  PRODUCTS_COLLECTION,
  ProductDocument,
  RESERVATIONS_COLLECTION,
  ReservationDocument,
} from './mongo-documents';
import { MongoProductRepository, MongoReservationRepository } from './mongo-repositories';

const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

/**
 * Two layers of concurrency control, one for each scope:
 *
 * 1. Within a process, a per-product KeyedMutex queues requests, so one
 *    instance never fights itself in the database. This keeps write conflicts
 *    and retries rare, even under a 500-request burst.
 *
 * 2. Across processes, every unit of work is a multi-document transaction
 *    with snapshot reads. Every state-changing use case writes the product
 *    document, so that document is the conflict point: if two instances race
 *    on the same product, MongoDB aborts one with a WriteConflict. The driver's
 *    `withTransaction` then re-runs that callback against fresh data, where
 *    the domain rules reject the oversell. Product and reservation writes
 *    commit together or not at all.
 *
 * MongoDB transactions require a replica set (a single-node one is fine).
 */
export class MongoUnitOfWork implements UnitOfWork {
  private readonly products;
  private readonly reservations;

  constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
    private readonly locks: ProductLock = new KeyedMutex(),
  ) {
    this.products = db.collection<ProductDocument>(PRODUCTS_COLLECTION);
    this.reservations = db.collection<ReservationDocument>(RESERVATIONS_COLLECTION);
  }

  /**
   * Creates collections and indexes up front. Creating collections implicitly
   * inside concurrent transactions would itself cause conflicts.
   */
  async initialize(): Promise<void> {
    await this.ensureCollection(PRODUCTS_COLLECTION);
    await this.ensureCollection(RESERVATIONS_COLLECTION);
    await this.reservations.createIndexes([
      // Sweeper: "which products have lapsed ACTIVE holds?"
      { key: { status: 1, expiresAt: 1 }, name: 'status_expiresAt' },
      // Lazy expiry: "lapsed ACTIVE holds of this product"
      { key: { productId: 1, status: 1, expiresAt: 1 }, name: 'productId_status_expiresAt' },
    ]);
  }

  runExclusive<T>(productId: string, work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.locks.runExclusive(productId, () =>
      this.client.withSession((session) =>
        session.withTransaction(() => work(this.repositoriesFor(session)), TRANSACTION_OPTIONS),
      ),
    );
  }

  /** Runs in a transaction that is always aborted: a consistent snapshot, and writes are discarded. */
  read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.client.withSession(async (session) => {
      session.startTransaction(TRANSACTION_OPTIONS);
      try {
        return await work(this.repositoriesFor(session));
      } finally {
        await session.abortTransaction();
      }
    });
  }

  private async ensureCollection(name: string): Promise<void> {
    const exists = await this.db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (!exists) await this.db.createCollection(name);
  }

  private repositoriesFor(session: ClientSession): Repositories {
    return {
      products: new MongoProductRepository(this.products, session),
      reservations: new MongoReservationRepository(this.reservations, session),
    };
  }
}
