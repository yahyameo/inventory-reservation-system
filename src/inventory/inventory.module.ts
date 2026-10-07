import { DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { EXPIRY_SWEEPER_OPTIONS, ExpirySweeper } from './application/expiry-sweeper';
import { INVENTORY_OPTIONS } from './application/inventory-options';
import { CLOCK } from './application/ports/clock';
import { ProductService } from './application/product.service';
import { ReservationExpiryService } from './application/reservation-expiry.service';
import { ReservationService } from './application/reservation.service';
import { ProductsController } from './http/products.controller';
import { ReservationsController } from './http/reservations.controller';
import { SystemClock } from './infrastructure/clock/system-clock';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';

@Module({})
export class InventoryModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: InventoryModule,
      imports: [PersistenceModule.forRoot(config.storage)],
      controllers: [ProductsController, ReservationsController],
      providers: [
        { provide: CLOCK, useClass: SystemClock },
        { provide: INVENTORY_OPTIONS, useValue: { reservationHoldMs: config.reservationHoldMs } },
        {
          provide: EXPIRY_SWEEPER_OPTIONS,
          useValue: { expirySweepIntervalMs: config.expirySweepIntervalMs },
        },
        ProductService,
        ReservationService,
        ReservationExpiryService,
        ExpirySweeper,
      ],
    };
  }
}
