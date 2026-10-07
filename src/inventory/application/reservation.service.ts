import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  InvariantViolationError,
  ProductNotFoundError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '../domain/errors';
import { Product } from '../domain/product';
import { Reservation } from '../domain/reservation';
import { INVENTORY_OPTIONS, InventoryOptions } from './inventory-options';
import { CLOCK, Clock } from './ports/clock';
import { Repositories } from './ports/repositories';
import { UNIT_OF_WORK, UnitOfWork } from './ports/unit-of-work';
import { ReservationExpiryService } from './reservation-expiry.service';

export interface ReserveCommand {
  productId: string;
  userId: string;
  quantity: number;
}

type TransitionOutcome = { kind: 'applied'; reservation: Reservation } | { kind: 'expired' };

/**
 * Reservation use cases. Each one is a single `runExclusive` block on the
 * reservation's product. Inside that block the service loads the aggregates,
 * releases lapsed holds, lets the domain objects apply the business rules,
 * and saves the result.
 */
@Injectable()
export class ReservationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly expiry: ReservationExpiryService,
    @Inject(INVENTORY_OPTIONS) private readonly options: InventoryOptions,
  ) {}

  reserve(command: ReserveCommand): Promise<Reservation> {
    return this.unitOfWork.runExclusive(command.productId, async (repositories) => {
      const now = this.clock.now();
      const product = await this.loadProduct(repositories, command.productId);
      await this.expiry.releaseDue(repositories, product, now);

      product.reserve(command.quantity); // throws InsufficientStockError
      const reservation = Reservation.create({
        id: randomUUID(),
        productId: product.id,
        userId: command.userId,
        quantity: command.quantity,
        now,
        holdDurationMs: this.options.reservationHoldMs,
      });

      await repositories.products.save(product);
      await repositories.reservations.save(reservation);
      return reservation;
    });
  }

  confirm(reservationId: string): Promise<Reservation> {
    return this.transition(reservationId, (reservation, product, now) => {
      reservation.confirm(now);
      product.confirmSale(reservation.quantity);
    });
  }

  cancel(reservationId: string): Promise<Reservation> {
    return this.transition(reservationId, (reservation, product, now) => {
      reservation.cancel(now);
      product.releaseReservation(reservation.quantity);
    });
  }

  /** Returns the reservation with its effective status: a lapsed hold is expired first. */
  async get(reservationId: string): Promise<Reservation> {
    const productId = await this.findProductIdOf(reservationId);
    return this.unitOfWork.runExclusive(productId, async (repositories) => {
      const product = await this.loadProduct(repositories, productId);
      await this.expiry.releaseDue(repositories, product, this.clock.now());
      return this.loadReservation(repositories, reservationId);
    });
  }

  /**
   * Shared flow for confirm and cancel.
   *
   * If the hold has lapsed, the reservation is expired and its stock released
   * in the same unit of work. The commit must succeed, so the error is raised
   * only AFTER it: throwing inside would roll the expiry back.
   */
  private async transition(
    reservationId: string,
    apply: (reservation: Reservation, product: Product, now: Date) => void,
  ): Promise<Reservation> {
    const productId = await this.findProductIdOf(reservationId);

    const outcome = await this.unitOfWork.runExclusive(
      productId,
      async (repositories): Promise<TransitionOutcome> => {
        const now = this.clock.now();
        const product = await this.loadProduct(repositories, productId);
        const reservation = await this.loadReservation(repositories, reservationId);

        if (reservation.isDueForExpiry(now)) {
          await this.expiry.releaseDue(repositories, product, now);
          return { kind: 'expired' };
        }

        apply(reservation, product, now);
        await repositories.reservations.save(reservation);
        await repositories.products.save(product);
        return { kind: 'applied', reservation };
      },
    );

    if (outcome.kind === 'expired') {
      throw new ReservationExpiredError(reservationId);
    }
    return outcome.reservation;
  }

  /**
   * Finds which product (and therefore which lock) a reservation belongs to.
   * This read happens outside the lock, which is safe because a reservation's
   * productId never changes. Its state is re-read inside the lock.
   */
  private async findProductIdOf(reservationId: string): Promise<string> {
    const reservation = await this.unitOfWork.read((repositories) =>
      repositories.reservations.findById(reservationId),
    );
    if (!reservation) throw new ReservationNotFoundError(reservationId);
    return reservation.productId;
  }

  private async loadProduct(repositories: Repositories, productId: string): Promise<Product> {
    const product = await repositories.products.findById(productId);
    if (!product) throw new ProductNotFoundError(productId);
    return product;
  }

  private async loadReservation(
    repositories: Repositories,
    reservationId: string,
  ): Promise<Reservation> {
    const reservation = await repositories.reservations.findById(reservationId);
    if (!reservation) {
      throw new InvariantViolationError(`reservation ${reservationId} vanished while locked`);
    }
    return reservation;
  }
}
