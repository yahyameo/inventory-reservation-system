import { KeyedMutex } from './keyed-mutex';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('KeyedMutex', () => {
  it('never lets two tasks on the same key overlap', async () => {
    const mutex = new KeyedMutex();
    let inside = 0;
    let maxInside = 0;

    await Promise.all(
      Array.from({ length: 50 }, () =>
        mutex.runExclusive('product-1', async () => {
          inside += 1;
          maxInside = Math.max(maxInside, inside);
          await tick();
          inside -= 1;
        }),
      ),
    );

    expect(maxInside).toBe(1);
  });

  it('runs tasks on the same key in FIFO order', async () => {
    const mutex = new KeyedMutex();
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        mutex.runExclusive('k', async () => {
          await tick();
          order.push(n);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('lets tasks on different keys run concurrently', async () => {
    const mutex = new KeyedMutex();
    let releaseA!: () => void;
    const aBlocked = new Promise<void>((resolve) => (releaseA = resolve));

    const a = mutex.runExclusive('a', () => aBlocked);
    const b = mutex.runExclusive('b', () => Promise.resolve('b done'));

    await expect(b).resolves.toBe('b done');
    releaseA();
    await a;
  });

  it('returns the task result and propagates errors', async () => {
    const mutex = new KeyedMutex();

    await expect(mutex.runExclusive('k', () => Promise.resolve(42))).resolves.toBe(42);
    await expect(mutex.runExclusive('k', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
  });

  it('releases the lock when a task fails, so later tasks still run', async () => {
    const mutex = new KeyedMutex();

    const failing = mutex.runExclusive('k', () => Promise.reject(new Error('boom')));
    const next = mutex.runExclusive('k', () => Promise.resolve('ran'));

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ran');
  });

  it('forgets keys once their queue drains (no memory leak per product)', async () => {
    const mutex = new KeyedMutex();

    await Promise.all(['a', 'b', 'a'].map((key) => mutex.runExclusive(key, async () => tick())));

    expect(mutex.heldKeyCount).toBe(0);
  });
});
