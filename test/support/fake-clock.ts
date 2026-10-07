import { Clock } from '../../src/inventory/application/ports/clock';

/** A controllable clock: time only moves when a test says so. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-01-01T10:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceBy(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
