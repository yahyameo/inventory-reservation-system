import { createInventory, TWO_MINUTES_MS } from '../../../test/support/inventory-fixture';
import { InsufficientStockError, ReservationExpiredError } from '../domain/errors';
import { ReservationStatus } from '../domain/reservation-status';
import { ProductLock } from '../infrastructure/concurrency/product-lock';
import { InMemoryUnitOfWork } from '../infrastructure/memory/in-memory-unit-of-work';

/** Fires `count` calls at once and sorts the settled results into successes and failures. */
async function fireConcurrently<T>(count: number, call: (i: number) => Promise<T>) {
  const results = await Promise.allSettled(Array.from({ length: count }, (_, i) => call(i)));
  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<Awaited<T>> => r.status === 'fulfilled',
  );
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { fulfilled, rejected };
}

describe('Level 3: concurrency', () => {
  it('stock = 1, 500 simultaneous requests → exactly 1 success and 499 failures', async () => {
    const inventory = createInventory();
    const { id: productId } = await inventory.products.create({ name: 'Last pair', totalStock: 1 });

    const { fulfilled, rejected } = await fireConcurrently(500, (i) =>
      inventory.reservations.reserve({ productId, userId: `user-${i}`, quantity: 1 }),
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(499);
    expect(rejected.every((r) => r.reason instanceof InsufficientStockError)).toBe(true);
    const product = await inventory.products.get(productId);
    expect(product.reservedQuantity).toBe(1);
    expect(product.availableStock).toBe(0);
  });

  it('stock = 10, 500 simultaneous requests → exactly 10 successes', async () => {
    const inventory = createInventory();
    const { id: productId } = await inventory.products.create({ name: 'Drop', totalStock: 10 });

    const { fulfilled, rejected } = await fireConcurrently(500, (i) =>
      inventory.reservations.reserve({ productId, userId: `user-${i}`, quantity: 1 }),
    );

    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(490);
    expect(new Set(fulfilled.map((r) => r.value.userId)).size).toBe(10);
  });

  it('mixed quantities never oversell: units granted never exceed stock', async () => {
    const inventory = createInventory();
    const { id: productId } = await inventory.products.create({ name: 'Bundle', totalStock: 25 });

    const { fulfilled } = await fireConcurrently(300, (i) =>
      inventory.reservations.reserve({ productId, userId: `u-${i}`, quantity: (i % 3) + 1 }),
    );

    const granted = fulfilled.reduce((sum, r) => sum + r.value.quantity, 0);
    const product = await inventory.products.get(productId);
    expect(granted).toBeLessThanOrEqual(25);
    expect(product.reservedQuantity).toBe(granted);
    expect(product.availableStock).toBe(25 - granted);
  });

  it('contention on one product does not block another product', async () => {
    const inventory = createInventory();
    const hot = await inventory.products.create({ name: 'Hot', totalStock: 1 });
    const cold = await inventory.products.create({ name: 'Cold', totalStock: 1 });

    const [hotResults, coldReservation] = await Promise.all([
      fireConcurrently(200, (i) =>
        inventory.reservations.reserve({ productId: hot.id, userId: `h-${i}`, quantity: 1 }),
      ),
      inventory.reservations.reserve({ productId: cold.id, userId: 'c', quantity: 1 }),
    ]);

    expect(hotResults.fulfilled).toHaveLength(1);
    expect(coldReservation.status).toBe(ReservationStatus.Active);
  });

  it('confirm and cancel racing on one reservation: exactly one wins', async () => {
    const inventory = createInventory();
    const { id: productId } = await inventory.products.create({ name: 'Item', totalStock: 1 });
    const { id } = await inventory.reservations.reserve({ productId, userId: 'a', quantity: 1 });

    const results = await Promise.allSettled([
      inventory.reservations.confirm(id),
      inventory.reservations.cancel(id),
      inventory.reservations.confirm(id),
      inventory.reservations.cancel(id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const product = await inventory.products.get(productId);
    expect(product.soldQuantity + product.availableStock).toBe(1);
    expect(product.reservedQuantity).toBe(0);
  });

  it('a confirm racing the expiry sweeper at the deadline never sells released stock', async () => {
    const inventory = createInventory();
    const { id: productId } = await inventory.products.create({ name: 'Item', totalStock: 1 });
    const { id } = await inventory.reservations.reserve({ productId, userId: 'a', quantity: 1 });
    inventory.clock.advanceBy(TWO_MINUTES_MS);

    const [confirmResult] = await Promise.allSettled([
      inventory.reservations.confirm(id),
      inventory.expiry.releaseAllExpired(),
      inventory.reservations.reserve({ productId, userId: 'b', quantity: 1 }),
    ]);

    expect(confirmResult.status).toBe('rejected');
    expect((confirmResult as PromiseRejectedResult).reason).toBeInstanceOf(ReservationExpiredError);
    const product = await inventory.products.get(productId);
    expect(product.soldQuantity).toBe(0);
    expect(product.reservedQuantity + product.availableStock).toBe(1);
  });

  it('a full flash sale (reserve, then confirm/cancel/expire) ends with consistent stock', async () => {
    const inventory = createInventory();
    const { id: productId } = await inventory.products.create({ name: 'Sale', totalStock: 50 });

    const { fulfilled } = await fireConcurrently(400, (i) =>
      inventory.reservations.reserve({ productId, userId: `u-${i}`, quantity: 1 }),
    );
    const reservations = fulfilled.map((r) => r.value);
    await Promise.allSettled(
      reservations.map(
        (r, i) =>
          i % 3 === 0
            ? inventory.reservations.confirm(r.id)
            : i % 3 === 1
              ? inventory.reservations.cancel(r.id)
              : Promise.resolve(), // left to expire
      ),
    );
    inventory.clock.advanceBy(TWO_MINUTES_MS);
    await inventory.expiry.releaseAllExpired();

    const product = await inventory.products.get(productId);
    const confirmed = reservations.filter((_, i) => i % 3 === 0).length;
    expect(reservations).toHaveLength(50);
    expect(product.soldQuantity).toBe(confirmed);
    expect(product.reservedQuantity).toBe(0);
    expect(product.availableStock).toBe(50 - confirmed);
  });

  describe('control experiment: without the per-product lock', () => {
    /** A "lock" that does nothing, to show the race that KeyedMutex prevents. */
    const noLock: ProductLock = { runExclusive: (_key, task) => task() };

    it('the same 500-request scenario oversells, so the lock is what makes it correct', async () => {
      const inventory = createInventory({ unitOfWork: new InMemoryUnitOfWork(noLock) });
      const { id: productId } = await inventory.products.create({ name: 'Last', totalStock: 1 });

      const { fulfilled } = await fireConcurrently(500, (i) =>
        inventory.reservations.reserve({ productId, userId: `user-${i}`, quantity: 1 }),
      );

      expect(fulfilled.length).toBeGreaterThan(1); // oversold!
    });
  });
});
