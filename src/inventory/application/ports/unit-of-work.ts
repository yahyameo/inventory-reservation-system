import { Repositories } from './repositories';

/**
 * The single concurrency boundary of the application.
 *
 * Every state change touches exactly one product's stock (and maybe its
 * reservations), so isolation is scoped per product. Application services
 * describe WHAT must happen atomically. Adapters decide HOW to guarantee it:
 *  - in-memory: a per-product mutex plus staged writes committed at the end
 *  - MongoDB:   a per-product mutex (within a process) plus a multi-document
 *               transaction (across processes)
 */
export interface UnitOfWork {
  /**
   * Runs `work` atomically and in isolation from every other `runExclusive`
   * call for the same product:
   *  - no other work on that product can interleave with it;
   *  - if `work` throws, none of its writes are persisted.
   *
   * `work` may be retried after a transient conflict, so it must only cause
   * side effects through the repositories it is given.
   */
  runExclusive<T>(productId: string, work: (repositories: Repositories) => Promise<T>): Promise<T>;

  /**
   * Read-only access to committed state with no locking. Use it for lookups
   * whose result is re-checked inside `runExclusive`. Any writes made here are discarded.
   */
  read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
