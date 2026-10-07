import { InsufficientStockError, InvalidQuantityError } from './errors';
import { Product } from './product';

describe('Product', () => {
  const create = (totalStock: number) => Product.create({ id: 'p-1', name: 'Sneaker', totalStock });

  describe('create', () => {
    it('starts with all stock available', () => {
      const product = create(5);

      expect(product.availableStock).toBe(5);
      expect(product.reservedQuantity).toBe(0);
      expect(product.soldQuantity).toBe(0);
    });

    it.each([-1, 1.5, Number.NaN])('rejects an invalid total stock of %p', (totalStock) => {
      expect(() => create(totalStock)).toThrow(InvalidQuantityError);
    });

    it('allows a product with zero stock', () => {
      expect(create(0).availableStock).toBe(0);
    });
  });

  describe('reserve', () => {
    it('moves quantity from available to reserved', () => {
      const product = create(5);

      product.reserve(2);

      expect(product.availableStock).toBe(3);
      expect(product.reservedQuantity).toBe(2);
    });

    it('lets the only remaining unit be reserved once (stock = 1: A succeeds, B fails)', () => {
      const product = create(1);

      product.reserve(1);

      expect(() => product.reserve(1)).toThrow(InsufficientStockError);
      expect(product.availableStock).toBe(0);
    });

    it('rejects a reservation larger than available stock and leaves state unchanged', () => {
      const product = create(3);

      expect(() => product.reserve(4)).toThrow(InsufficientStockError);
      expect(product.availableStock).toBe(3);
      expect(product.reservedQuantity).toBe(0);
    });

    it.each([0, -1, 1.5])('rejects a non-positive or fractional quantity of %p', (quantity) => {
      expect(() => create(3).reserve(quantity)).toThrow(InvalidQuantityError);
    });
  });

  describe('releaseReservation', () => {
    it('returns reserved quantity to available stock', () => {
      const product = create(2);
      product.reserve(2);

      product.releaseReservation(2);

      expect(product.availableStock).toBe(2);
      expect(product.reservedQuantity).toBe(0);
    });

    it('refuses to release more than is reserved (invariant guard)', () => {
      const product = create(2);
      product.reserve(1);

      expect(() => product.releaseReservation(2)).toThrow();
    });
  });

  describe('confirmSale', () => {
    it('moves reserved quantity to sold; available stock is unchanged', () => {
      const product = create(3);
      product.reserve(2);

      product.confirmSale(2);

      expect(product.reservedQuantity).toBe(0);
      expect(product.soldQuantity).toBe(2);
      expect(product.availableStock).toBe(1);
    });

    it('refuses to sell more than is reserved (invariant guard)', () => {
      const product = create(3);

      expect(() => product.confirmSale(1)).toThrow();
    });
  });

  it('obeys available = total - sold - reserved', () => {
    const product = create(10);
    product.reserve(4);
    product.confirmSale(3);
    product.reserve(2);

    expect(product.availableStock).toBe(10 - 3 - 3);
  });

  it('round-trips through a snapshot', () => {
    const product = create(4);
    product.reserve(3);
    product.confirmSale(1);

    const restored = Product.fromSnapshot(product.toSnapshot());

    expect(restored.toSnapshot()).toEqual(product.toSnapshot());
  });
});
