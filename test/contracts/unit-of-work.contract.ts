import { UnitOfWork } from '../../src/inventory/application/ports/unit-of-work';
import { Product } from '../../src/inventory/domain/product';
import { Reservation } from '../../src/inventory/domain/reservation';

/**
 * Behaviour every UnitOfWork adapter must provide. It runs against the
 * in-memory adapter (unit project) and the MongoDB adapter (mongo project).
 */
export function unitOfWorkContract(
  name: string,
  createUnitOfWork: () => Promise<UnitOfWork>,
): void {
  describe(`${name} (UnitOfWork contract)`, () => {
    let uow: UnitOfWork;
    let productSeq = 0;
    const nextProductId = () => `contract-product-${Date.now()}-${++productSeq}`;

    beforeEach(async () => {
      uow = await createUnitOfWork();
    });

    const seed = async (totalStock: number) => {
      const product = Product.create({ id: nextProductId(), name: 'Widget', totalStock });
      await uow.runExclusive(product.id, (repos) => repos.products.save(product));
      return product.id;
    };

    const readProduct = (productId: string) =>
      uow.read((repos) => repos.products.findById(productId));

    it('persists writes when the work succeeds', async () => {
      const productId = await seed(3);

      await uow.runExclusive(productId, async (repos) => {
        const product = (await repos.products.findById(productId))!;
        product.reserve(2);
        await repos.products.save(product);
      });

      expect((await readProduct(productId))?.availableStock).toBe(1);
    });

    it('discards every write when the work throws (all-or-nothing)', async () => {
      const productId = await seed(3);
      const reservation = Reservation.create({
        id: `${productId}-r`,
        productId,
        userId: 'u',
        quantity: 1,
        now: new Date(),
        holdDurationMs: 60_000,
      });

      await expect(
        uow.runExclusive(productId, async (repos) => {
          const product = (await repos.products.findById(productId))!;
          product.reserve(1);
          await repos.products.save(product);
          await repos.reservations.save(reservation);
          throw new Error('fail after writing');
        }),
      ).rejects.toThrow('fail after writing');

      expect((await readProduct(productId))?.availableStock).toBe(3);
      expect(await uow.read((repos) => repos.reservations.findById(reservation.id))).toBeNull();
    });

    it('sees its own writes inside the same unit of work', async () => {
      const productId = await seed(5);

      const seen = await uow.runExclusive(productId, async (repos) => {
        const product = (await repos.products.findById(productId))!;
        product.reserve(4);
        await repos.products.save(product);
        return (await repos.products.findById(productId))?.availableStock;
      });

      expect(seen).toBe(1);
    });

    it('hands out detached objects: mutating without save changes nothing', async () => {
      const productId = await seed(2);

      await uow.runExclusive(productId, async (repos) => {
        (await repos.products.findById(productId))!.reserve(2);
      });

      expect((await readProduct(productId))?.availableStock).toBe(2);
    });

    it('isolates concurrent read-modify-write cycles on the same product', async () => {
      const productId = await seed(1_000);
      const workers = 50;

      await Promise.all(
        Array.from({ length: workers }, () =>
          uow.runExclusive(productId, async (repos) => {
            const product = (await repos.products.findById(productId))!;
            product.reserve(1);
            await repos.products.save(product);
          }),
        ),
      );

      expect((await readProduct(productId))?.reservedQuantity).toBe(workers);
    });

    it('finds reservations due for expiry by product', async () => {
      const productId = await seed(5);
      const now = new Date('2026-01-01T10:00:00.000Z');
      const make = (id: string, holdDurationMs: number) =>
        Reservation.create({ id, productId, userId: 'u', quantity: 1, now, holdDurationMs });
      const due = make(`${productId}-due`, 1_000);
      const notDue = make(`${productId}-not-due`, 60_000);
      const confirmed = make(`${productId}-confirmed`, 1_000);
      confirmed.confirm(now);

      await uow.runExclusive(productId, async (repos) => {
        for (const r of [due, notDue, confirmed]) await repos.reservations.save(r);
      });

      const later = new Date(now.getTime() + 5_000);
      const found = await uow.read((repos) =>
        repos.reservations.findDueForExpiry(productId, later),
      );
      const productIds = await uow.read((repos) =>
        repos.reservations.findProductIdsWithDueReservations(later),
      );

      expect(found.map((r) => r.id)).toEqual([due.id]);
      expect(productIds).toContain(productId);
    });

    it('round-trips a reservation with all its fields', async () => {
      const productId = await seed(1);
      const reservation = Reservation.create({
        id: `${productId}-rt`,
        productId,
        userId: 'user-42',
        quantity: 1,
        now: new Date('2026-01-01T10:00:00.000Z'),
        holdDurationMs: 120_000,
      });

      await uow.runExclusive(productId, (repos) => repos.reservations.save(reservation));
      const loaded = await uow.read((repos) => repos.reservations.findById(reservation.id));

      expect(loaded?.toSnapshot()).toEqual(reservation.toSnapshot());
    });
  });
}
