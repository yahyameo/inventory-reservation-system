import { createInventory, TWO_MINUTES_MS } from '../../../test/support/inventory-fixture';
import {
  InsufficientStockError,
  InvalidQuantityError,
  InvalidReservationStateError,
  ProductNotFoundError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '../domain/errors';
import { ReservationStatus } from '../domain/reservation-status';

describe('ReservationService', () => {
  let inventory: ReturnType<typeof createInventory>;

  beforeEach(() => {
    inventory = createInventory();
  });

  const createProduct = async (totalStock: number) =>
    (await inventory.products.create({ name: 'Limited sneaker', totalStock })).id;

  const availableStock = async (productId: string) =>
    (await inventory.products.get(productId)).availableStock;

  describe('Level 1: basic reservation', () => {
    it('reserves stock when it is available', async () => {
      const productId = await createProduct(5);

      const reservation = await inventory.reservations.reserve({
        productId,
        userId: 'user-a',
        quantity: 2,
      });

      expect(reservation.status).toBe(ReservationStatus.Active);
      expect(reservation.quantity).toBe(2);
      expect(await availableStock(productId)).toBe(3);
    });

    it('stock = 1: user A succeeds, user B fails', async () => {
      const productId = await createProduct(1);

      await expect(
        inventory.reservations.reserve({ productId, userId: 'user-a', quantity: 1 }),
      ).resolves.toBeDefined();
      await expect(
        inventory.reservations.reserve({ productId, userId: 'user-b', quantity: 1 }),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('rejects a reservation that exceeds available stock', async () => {
      const productId = await createProduct(2);

      await expect(
        inventory.reservations.reserve({ productId, userId: 'user-a', quantity: 3 }),
      ).rejects.toThrow(InsufficientStockError);
      expect(await availableStock(productId)).toBe(2);
    });

    it('rejects a reservation for an unknown product', async () => {
      await expect(
        inventory.reservations.reserve({ productId: 'nope', userId: 'user-a', quantity: 1 }),
      ).rejects.toThrow(ProductNotFoundError);
    });

    it('rejects an invalid quantity', async () => {
      const productId = await createProduct(2);

      await expect(
        inventory.reservations.reserve({ productId, userId: 'user-a', quantity: 0 }),
      ).rejects.toThrow(InvalidQuantityError);
    });
  });

  describe('Level 2: lifecycle and expiry', () => {
    it('holds stock for 2 minutes', async () => {
      const productId = await createProduct(1);

      const reservation = await inventory.reservations.reserve({
        productId,
        userId: 'user-a',
        quantity: 1,
      });

      expect(reservation.expiresAt.getTime() - reservation.createdAt.getTime()).toBe(
        TWO_MINUTES_MS,
      );
    });

    describe('confirm', () => {
      it('completes the purchase: stock becomes sold and stays unavailable', async () => {
        const productId = await createProduct(1);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });

        const confirmed = await inventory.reservations.confirm(id);
        inventory.clock.advanceBy(TWO_MINUTES_MS * 5);

        const product = await inventory.products.get(productId);
        expect(confirmed.status).toBe(ReservationStatus.Confirmed);
        expect(product.soldQuantity).toBe(1);
        expect(product.availableStock).toBe(0);
      });

      it('cannot confirm twice', async () => {
        const productId = await createProduct(1);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });
        await inventory.reservations.confirm(id);

        await expect(inventory.reservations.confirm(id)).rejects.toThrow(
          InvalidReservationStateError,
        );
        expect((await inventory.products.get(productId)).soldQuantity).toBe(1);
      });

      it('cannot confirm after the hold has elapsed, and the stock is released', async () => {
        const productId = await createProduct(1);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });
        inventory.clock.advanceBy(TWO_MINUTES_MS);

        await expect(inventory.reservations.confirm(id)).rejects.toThrow(ReservationExpiredError);
        expect((await inventory.reservations.get(id)).status).toBe(ReservationStatus.Expired);
        expect(await availableStock(productId)).toBe(1);
      });

      it('fails for an unknown reservation', async () => {
        await expect(inventory.reservations.confirm('missing')).rejects.toThrow(
          ReservationNotFoundError,
        );
      });
    });

    describe('cancel', () => {
      it('releases the held stock', async () => {
        const productId = await createProduct(1);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });

        const cancelled = await inventory.reservations.cancel(id);

        expect(cancelled.status).toBe(ReservationStatus.Cancelled);
        expect(await availableStock(productId)).toBe(1);
      });

      it('cannot reverse a confirmed purchase', async () => {
        const productId = await createProduct(1);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });
        await inventory.reservations.confirm(id);

        await expect(inventory.reservations.cancel(id)).rejects.toThrow(
          InvalidReservationStateError,
        );
        expect(await availableStock(productId)).toBe(0);
      });

      it('cannot cancel twice (stock is released only once)', async () => {
        const productId = await createProduct(2);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });
        await inventory.reservations.reserve({ productId, userId: 'user-b', quantity: 1 });
        await inventory.reservations.cancel(id);

        await expect(inventory.reservations.cancel(id)).rejects.toThrow(
          InvalidReservationStateError,
        );
        expect(await availableStock(productId)).toBe(1);
      });

      it('reports an elapsed hold as expired', async () => {
        const productId = await createProduct(1);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });
        inventory.clock.advanceBy(TWO_MINUTES_MS + 1);

        await expect(inventory.reservations.cancel(id)).rejects.toThrow(ReservationExpiredError);
        expect(await availableStock(productId)).toBe(1);
      });
    });

    describe('expiry', () => {
      it('releases expired stock automatically on the next reservation attempt', async () => {
        const productId = await createProduct(1);
        const first = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });
        await expect(
          inventory.reservations.reserve({ productId, userId: 'user-b', quantity: 1 }),
        ).rejects.toThrow(InsufficientStockError);

        inventory.clock.advanceBy(TWO_MINUTES_MS);
        const second = await inventory.reservations.reserve({
          productId,
          userId: 'user-b',
          quantity: 1,
        });

        expect(second.status).toBe(ReservationStatus.Active);
        expect((await inventory.reservations.get(first.id)).status).toBe(ReservationStatus.Expired);
      });

      it('keeps holding stock until the exact expiry instant', async () => {
        const productId = await createProduct(1);
        await inventory.reservations.reserve({ productId, userId: 'user-a', quantity: 1 });

        inventory.clock.advanceBy(TWO_MINUTES_MS - 1);

        expect(await availableStock(productId)).toBe(0);
        inventory.clock.advanceBy(1);
        expect(await availableStock(productId)).toBe(1);
      });

      it('reports a lapsed reservation as EXPIRED when it is read', async () => {
        const productId = await createProduct(1);
        const { id } = await inventory.reservations.reserve({
          productId,
          userId: 'user-a',
          quantity: 1,
        });

        inventory.clock.advanceBy(TWO_MINUTES_MS);

        expect((await inventory.reservations.get(id)).status).toBe(ReservationStatus.Expired);
      });

      it('the sweeper releases every lapsed reservation across products', async () => {
        const productA = await createProduct(2);
        const productB = await createProduct(1);
        await inventory.reservations.reserve({ productId: productA, userId: 'u1', quantity: 2 });
        await inventory.reservations.reserve({ productId: productB, userId: 'u2', quantity: 1 });
        inventory.clock.advanceBy(TWO_MINUTES_MS);

        const released = await inventory.expiry.releaseAllExpired();

        expect(released).toBe(2);
        const snapshotA = await inventory.unitOfWork.read((r) => r.products.findById(productA));
        const snapshotB = await inventory.unitOfWork.read((r) => r.products.findById(productB));
        expect(snapshotA?.availableStock).toBe(2);
        expect(snapshotB?.availableStock).toBe(1);
      });

      it('the sweeper leaves active, confirmed and cancelled reservations alone', async () => {
        const productId = await createProduct(3);
        const toConfirm = await inventory.reservations.reserve({
          productId,
          userId: 'u1',
          quantity: 1,
        });
        const toCancel = await inventory.reservations.reserve({
          productId,
          userId: 'u2',
          quantity: 1,
        });
        await inventory.reservations.reserve({ productId, userId: 'u3', quantity: 1 });
        await inventory.reservations.confirm(toConfirm.id);
        await inventory.reservations.cancel(toCancel.id);

        expect(await inventory.expiry.releaseAllExpired()).toBe(0);
        const product = await inventory.unitOfWork.read((r) => r.products.findById(productId));
        expect(product?.toSnapshot()).toMatchObject({ soldQuantity: 1, reservedQuantity: 1 });
      });
    });
  });
});
