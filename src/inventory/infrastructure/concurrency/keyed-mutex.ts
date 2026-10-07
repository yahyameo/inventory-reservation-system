/**
 * An async mutex per key (here: per product id).
 *
 * Why it is needed in single-threaded Node.js: JavaScript never runs two
 * callbacks at the same instant, but an `async` function gives up control at
 * every `await`. A read-check-write sequence such as
 *
 *   const product = await repo.findById(id);   // ← other requests run here
 *   product.reserve(1);
 *   await repo.save(product);                  // ← and here
 *
 * can therefore interleave with hundreds of other requests that all read
 * "1 available" before any of them saves. Holding this lock around the whole
 * sequence makes it a critical section.
 *
 * Design:
 *  - Waiters form a promise chain per key, so they are served FIFO (fair, no
 *    starvation) without polling or busy-waiting.
 *  - Different keys never block each other, so a flash sale on one product
 *    does not slow down any other product.
 *  - The lock is released in `finally`, so a failing task cannot deadlock the key.
 *  - A key's entry is deleted when its queue drains, so memory is bounded by
 *    the number of products currently under contention.
 *
 * Scope: this serialises work inside ONE process. Multi-instance deployments
 * need a shared mechanism as well (see MongoUnitOfWork, which adds DB transactions).
 */
export class KeyedMutex {
  /** Per key: a promise that settles when the most recently queued task finishes. */
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      // Only the last waiter in the chain may delete the entry; otherwise a
      // newer waiter's tail would be dropped and the next caller would skip it.
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  /** Number of keys that currently have a running or queued task. */
  get heldKeyCount(): number {
    return this.tails.size;
  }
}
