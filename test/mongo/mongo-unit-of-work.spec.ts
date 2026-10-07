import { InsufficientStockError } from '../../src/inventory/domain/errors';
import { unitOfWorkContract } from '../contracts/unit-of-work.contract';
import { FakeClock } from '../support/fake-clock';
import { createInventory, TWO_MINUTES_MS } from '../support/inventory-fixture';
import { MongoTestEnvironment } from './mongo-test-env';

jest.setTimeout(120_000);

let env: MongoTestEnvironment;

beforeAll(async () => {
  env = await MongoTestEnvironment.start();
});

afterAll(async () => {
  await env.stop();
});

unitOfWorkContract('MongoUnitOfWork', () => env.createUnitOfWork());

describe('MongoUnitOfWork with the reservation use cases', () => {
  it('stock = 1, 500 simultaneous requests → exactly 1 success and 499 failures', async () => {
    const inventory = createInventory({ unitOfWork: await env.createUnitOfWork() });
    const { id: productId } = await inventory.products.create({ name: 'Last', totalStock: 1 });

    const results = await Promise.allSettled(
      Array.from({ length: 500 }, (_, i) =>
        inventory.reservations.reserve({ productId, userId: `user-${i}`, quantity: 1 }),
      ),
    );

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(499);
    expect(rejected.every((r) => r.reason instanceof InsufficientStockError)).toBe(true);
  });

  it('two application instances racing on the same product still never oversell', async () => {
    // Separate clients AND separate in-process locks: only MongoDB
    // transactions stand between these two "servers".
    const clock = new FakeClock();
    const sharedDb = env.newDatabaseName();
    const instanceA = createInventory({ unitOfWork: await env.createUnitOfWork(sharedDb), clock });
    const instanceB = createInventory({ unitOfWork: await env.createUnitOfWork(sharedDb), clock });
    const { id: productId } = await instanceA.products.create({ name: 'Shared', totalStock: 3 });

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        (i % 2 === 0 ? instanceA : instanceB).reservations.reserve({
          productId,
          userId: `user-${i}`,
          quantity: 1,
        }),
      ),
    );

    const product = await instanceB.products.get(productId);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(product.reservedQuantity).toBe(3);
    expect(product.availableStock).toBe(0);
  });

  it('runs the full lifecycle: reserve → confirm, reserve → cancel, reserve → expire', async () => {
    const inventory = createInventory({ unitOfWork: await env.createUnitOfWork() });
    const { id: productId } = await inventory.products.create({ name: 'Cycle', totalStock: 3 });

    const toConfirm = await inventory.reservations.reserve({ productId, userId: 'a', quantity: 1 });
    const toCancel = await inventory.reservations.reserve({ productId, userId: 'b', quantity: 1 });
    await inventory.reservations.reserve({ productId, userId: 'c', quantity: 1 });
    await inventory.reservations.confirm(toConfirm.id);
    await inventory.reservations.cancel(toCancel.id);
    inventory.clock.advanceBy(TWO_MINUTES_MS);

    expect(await inventory.expiry.releaseAllExpired()).toBe(1);
    const product = await inventory.products.get(productId);
    expect(product.toSnapshot()).toMatchObject({ soldQuantity: 1, reservedQuantity: 0 });
    expect(product.availableStock).toBe(2);
  });
});
