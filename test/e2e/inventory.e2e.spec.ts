import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule, configureApp } from '../../src/app.module';
import { loadAppConfig } from '../../src/config/app-config';
import { CLOCK } from '../../src/inventory/application/ports/clock';
import { FakeClock } from '../support/fake-clock';
import { TWO_MINUTES_MS } from '../support/inventory-fixture';

describe('Inventory reservation API (e2e)', () => {
  let app: INestApplication;
  let clock: FakeClock;
  let baseUrl: string;

  beforeEach(async () => {
    clock = new FakeClock();
    const config = loadAppConfig({ EXPIRY_SWEEP_INTERVAL_MS: '0' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterEach(async () => {
    await app.close();
  });

  const api = () => request(baseUrl);

  const createProduct = async (totalStock: number) => {
    const res = await api().post('/products').send({ name: 'Limited sneaker', totalStock });
    return res.body.id as string;
  };

  const reserve = (productId: string, userId = 'user-a', quantity?: number) =>
    api().post(`/products/${productId}/reservations`).send({ userId, quantity });

  describe('products', () => {
    it('creates a product with all stock available', async () => {
      const res = await api().post('/products').send({ name: 'Sneaker', totalStock: 3 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: 'Sneaker',
        totalStock: 3,
        availableStock: 3,
        reservedQuantity: 0,
        soldQuantity: 0,
      });
    });

    it.each([
      [{ name: 'X', totalStock: -1 }],
      [{ name: 'X', totalStock: 1.5 }],
      [{ name: '', totalStock: 1 }],
      [{ totalStock: 1 }],
      [{ name: 'X', totalStock: 1, unexpected: true }],
    ])('rejects an invalid payload %p with 400', async (body) => {
      const res = await api().post('/products').send(body);

      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown product and 400 for a malformed id', async () => {
      expect((await api().get('/products/7f1d6a1e-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await api().get('/products/not-a-uuid')).status).toBe(400);
    });
  });

  describe('reservations', () => {
    it('stock = 1: user A gets 201, user B gets 409 INSUFFICIENT_STOCK', async () => {
      const productId = await createProduct(1);

      const first = await reserve(productId, 'user-a');
      const second = await reserve(productId, 'user-b');

      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        productId,
        userId: 'user-a',
        quantity: 1,
        status: 'ACTIVE',
      });
      expect(
        new Date(first.body.expiresAt).getTime() - new Date(first.body.createdAt).getTime(),
      ).toBe(TWO_MINUTES_MS);
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ statusCode: 409, error: 'INSUFFICIENT_STOCK' });
    });

    it('rejects an invalid reservation payload with 400', async () => {
      const productId = await createProduct(5);

      expect((await reserve(productId, 'user-a', 0)).status).toBe(400);
      expect((await reserve(productId, '')).status).toBe(400);
    });

    it('returns 404 when reserving an unknown product', async () => {
      const res = await reserve('7f1d6a1e-0000-4000-8000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('confirm completes the purchase and cannot be reversed', async () => {
      const productId = await createProduct(1);
      const { body: reservation } = await reserve(productId);

      const confirmed = await api().post(`/reservations/${reservation.id}/confirm`);
      const cancelAfterConfirm = await api().post(`/reservations/${reservation.id}/cancel`);
      const product = await api().get(`/products/${productId}`);

      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe('CONFIRMED');
      expect(cancelAfterConfirm.status).toBe(409);
      expect(cancelAfterConfirm.body.error).toBe('INVALID_RESERVATION_STATE');
      expect(product.body).toMatchObject({ availableStock: 0, soldQuantity: 1 });
    });

    it('cancel releases the stock for the next shopper', async () => {
      const productId = await createProduct(1);
      const { body: reservation } = await reserve(productId, 'user-a');

      const cancelled = await api().post(`/reservations/${reservation.id}/cancel`);
      const next = await reserve(productId, 'user-b');

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(next.status).toBe(201);
    });

    it('an expired reservation cannot be confirmed (410) and its stock is released', async () => {
      const productId = await createProduct(1);
      const { body: reservation } = await reserve(productId);
      clock.advanceBy(TWO_MINUTES_MS);

      const confirm = await api().post(`/reservations/${reservation.id}/confirm`);
      const fetched = await api().get(`/reservations/${reservation.id}`);
      const product = await api().get(`/products/${productId}`);

      expect(confirm.status).toBe(410);
      expect(confirm.body.error).toBe('RESERVATION_EXPIRED');
      expect(fetched.body.status).toBe('EXPIRED');
      expect(product.body.availableStock).toBe(1);
    });

    it('returns 404 for an unknown reservation', async () => {
      const res = await api().post('/reservations/7f1d6a1e-0000-4000-8000-000000000000/confirm');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('RESERVATION_NOT_FOUND');
    });
  });

  it('500 simultaneous HTTP requests for the last unit → one 201 and 499 × 409', async () => {
    const productId = await createProduct(1);

    const responses = await Promise.all(
      Array.from({ length: 500 }, (_, i) => reserve(productId, `user-${i}`)),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(499);
    const product = await api().get(`/products/${productId}`);
    expect(product.body).toMatchObject({ availableStock: 0, reservedQuantity: 1 });
  });
});
