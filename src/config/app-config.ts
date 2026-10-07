export type StorageConfig =
  | { readonly driver: 'memory' }
  | { readonly driver: 'mongo'; readonly url: string; readonly dbName: string };

export interface AppConfig {
  readonly port: number;
  readonly storage: StorageConfig;
  readonly reservationHoldMs: number;
  readonly expirySweepIntervalMs: number;
}

type Env = Record<string, string | undefined>;

/** Builds a validated configuration from environment variables. Fails fast at startup. */
export function loadAppConfig(env: Env = process.env): AppConfig {
  return {
    port: readInteger(env, 'PORT', 3000, { min: 1 }),
    storage: readStorage(env),
    reservationHoldMs: readInteger(env, 'RESERVATION_HOLD_MS', 2 * 60 * 1000, { min: 1 }),
    expirySweepIntervalMs: readInteger(env, 'EXPIRY_SWEEP_INTERVAL_MS', 5_000, { min: 0 }),
  };
}

function readStorage(env: Env): StorageConfig {
  const driver = env.STORAGE_DRIVER ?? 'memory';
  switch (driver) {
    case 'memory':
      return { driver };
    case 'mongo': {
      const url = env.MONGO_URL;
      if (!url) throw new Error('MONGO_URL is required when STORAGE_DRIVER=mongo');
      return { driver, url, dbName: env.MONGO_DB_NAME ?? 'inventory' };
    }
    default:
      throw new Error(`STORAGE_DRIVER must be "memory" or "mongo", got "${driver}"`);
  }
}

function readInteger(env: Env, name: string, fallback: number, { min }: { min: number }): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return value;
}
