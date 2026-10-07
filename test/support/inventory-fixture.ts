import { UnitOfWork } from '../../src/inventory/application/ports/unit-of-work';
import { InventoryOptions } from '../../src/inventory/application/inventory-options';
import { ProductService } from '../../src/inventory/application/product.service';
import { ReservationExpiryService } from '../../src/inventory/application/reservation-expiry.service';
import { ReservationService } from '../../src/inventory/application/reservation.service';
import { InMemoryUnitOfWork } from '../../src/inventory/infrastructure/memory/in-memory-unit-of-work';
import { FakeClock } from './fake-clock';

export const TWO_MINUTES_MS = 2 * 60 * 1000;

/** Wires the application services by hand (no Nest container) for fast unit tests. */
export function createInventory(
  overrides: { unitOfWork?: UnitOfWork; clock?: FakeClock; options?: InventoryOptions } = {},
) {
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const clock = overrides.clock ?? new FakeClock();
  const options = overrides.options ?? { reservationHoldMs: TWO_MINUTES_MS };
  const expiry = new ReservationExpiryService(unitOfWork, clock);

  return {
    unitOfWork,
    clock,
    expiry,
    products: new ProductService(unitOfWork, clock, expiry),
    reservations: new ReservationService(unitOfWork, clock, expiry, options),
  };
}
