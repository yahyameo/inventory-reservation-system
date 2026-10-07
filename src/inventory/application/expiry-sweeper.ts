import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ReservationExpiryService } from './reservation-expiry.service';

export interface ExpirySweeperOptions {
  /** Milliseconds between sweeps. 0 disables the sweeper (lazy expiry still applies). */
  readonly expirySweepIntervalMs: number;
}

export const EXPIRY_SWEEPER_OPTIONS = Symbol('EXPIRY_SWEEPER_OPTIONS');

/**
 * Releases lapsed reservations in the background, so stock comes back even
 * for products nobody is currently touching.
 *
 * It only speeds things up: correctness comes from lazy expiry inside each
 * use case. So a slow or failed sweep is logged and skipped, never fatal, and
 * sweeps never overlap.
 */
@Injectable()
export class ExpirySweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExpirySweeper.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly expiry: ReservationExpiryService,
    @Inject(EXPIRY_SWEEPER_OPTIONS) private readonly options: ExpirySweeperOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.expirySweepIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.sweep(), this.options.expirySweepIntervalMs);
    this.timer.unref(); // never keep the process alive just for the sweeper
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const released = await this.expiry.releaseAllExpired();
      if (released > 0) {
        this.logger.log(`Released ${released} expired reservation(s)`);
      }
    } catch (error: unknown) {
      this.logger.error('Expiry sweep failed; will retry on next tick', error);
    } finally {
      this.sweeping = false;
    }
  }
}
