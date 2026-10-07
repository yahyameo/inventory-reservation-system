import { Logger } from '@nestjs/common';
import { ExpirySweeper } from './expiry-sweeper';
import { ReservationExpiryService } from './reservation-expiry.service';

describe('ExpirySweeper', () => {
  const INTERVAL_MS = 5_000;
  let releaseAllExpired: jest.Mock<Promise<number>, []>;
  let sweeper: ExpirySweeper;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    releaseAllExpired = jest.fn<Promise<number>, []>().mockResolvedValue(0);
    const expiry = { releaseAllExpired } as unknown as ReservationExpiryService;
    sweeper = new ExpirySweeper(expiry, { expirySweepIntervalMs: INTERVAL_MS });
  });

  afterEach(() => {
    sweeper.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sweeps on every interval once started', async () => {
    sweeper.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(releaseAllExpired).toHaveBeenCalledTimes(3);
  });

  it('stops sweeping on shutdown', async () => {
    sweeper.onApplicationBootstrap();
    sweeper.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(releaseAllExpired).not.toHaveBeenCalled();
  });

  it('never runs two sweeps at once when a sweep is slower than the interval', async () => {
    let finish!: (n: number) => void;
    releaseAllExpired.mockImplementation(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );
    sweeper.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 4);
    expect(releaseAllExpired).toHaveBeenCalledTimes(1);

    finish(0);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(releaseAllExpired).toHaveBeenCalledTimes(2);
  });

  it('logs and survives a failing sweep (the next tick still runs)', async () => {
    releaseAllExpired.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(0);

    await expect(sweeper.sweep()).resolves.toBeUndefined();
    await sweeper.sweep();

    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(releaseAllExpired).toHaveBeenCalledTimes(2);
  });

  it('can be disabled with an interval of 0', async () => {
    const disabled = new ExpirySweeper(
      { releaseAllExpired } as unknown as ReservationExpiryService,
      {
        expirySweepIntervalMs: 0,
      },
    );
    disabled.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(60_000);

    expect(releaseAllExpired).not.toHaveBeenCalled();
    disabled.onModuleDestroy();
  });
});
