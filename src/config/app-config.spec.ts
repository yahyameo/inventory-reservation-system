import { loadAppConfig } from './app-config';

describe('loadAppConfig', () => {
  it('uses spec-compliant defaults (2-minute hold, in-memory storage)', () => {
    expect(loadAppConfig({})).toEqual({
      port: 3000,
      storage: { driver: 'memory' },
      reservationHoldMs: 120_000,
      expirySweepIntervalMs: 5_000,
    });
  });

  it('reads the Mongo settings when the mongo driver is selected', () => {
    const config = loadAppConfig({
      STORAGE_DRIVER: 'mongo',
      MONGO_URL: 'mongodb://db:27017/?replicaSet=rs0',
      MONGO_DB_NAME: 'shop',
    });

    expect(config.storage).toEqual({
      driver: 'mongo',
      url: 'mongodb://db:27017/?replicaSet=rs0',
      dbName: 'shop',
    });
  });

  it('parses numeric overrides', () => {
    const config = loadAppConfig({
      PORT: '8080',
      RESERVATION_HOLD_MS: '1000',
      EXPIRY_SWEEP_INTERVAL_MS: '0',
    });

    expect(config).toMatchObject({ port: 8080, reservationHoldMs: 1000, expirySweepIntervalMs: 0 });
  });

  it.each([
    [{ STORAGE_DRIVER: 'redis' }, /STORAGE_DRIVER/],
    [{ STORAGE_DRIVER: 'mongo' }, /MONGO_URL/],
    [{ RESERVATION_HOLD_MS: '0' }, /RESERVATION_HOLD_MS/],
    [{ RESERVATION_HOLD_MS: 'two minutes' }, /RESERVATION_HOLD_MS/],
    [{ PORT: '-1' }, /PORT/],
  ])('fails fast on invalid configuration %p', (env, message) => {
    expect(() => loadAppConfig(env)).toThrow(message);
  });
});
