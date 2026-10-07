import { ClientSession, Collection } from 'mongodb';
import { ProductRepository, ReservationRepository } from '../../application/ports/repositories';
import { Product } from '../../domain/product';
import { Reservation } from '../../domain/reservation';
import { ReservationStatus } from '../../domain/reservation-status';
import { ProductDocument, ReservationDocument } from './mongo-documents';

export class MongoProductRepository implements ProductRepository {
  constructor(
    private readonly collection: Collection<ProductDocument>,
    private readonly session: ClientSession,
  ) {}

  async findById(productId: string): Promise<Product | null> {
    const doc = await this.collection.findOne({ _id: productId }, { session: this.session });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return Product.fromSnapshot({ id: _id, ...rest });
  }

  async save(product: Product): Promise<void> {
    const { id, ...rest } = product.toSnapshot();
    await this.collection.replaceOne({ _id: id }, rest, { upsert: true, session: this.session });
  }
}

export class MongoReservationRepository implements ReservationRepository {
  constructor(
    private readonly collection: Collection<ReservationDocument>,
    private readonly session: ClientSession,
  ) {}

  async findById(reservationId: string): Promise<Reservation | null> {
    const doc = await this.collection.findOne({ _id: reservationId }, { session: this.session });
    return doc ? toReservation(doc) : null;
  }

  async save(reservation: Reservation): Promise<void> {
    const { id, ...rest } = reservation.toSnapshot();
    await this.collection.replaceOne({ _id: id }, rest, { upsert: true, session: this.session });
  }

  async findDueForExpiry(productId: string, now: Date): Promise<Reservation[]> {
    const docs = await this.collection
      .find(
        { productId, status: ReservationStatus.Active, expiresAt: { $lte: now } },
        { session: this.session },
      )
      .toArray();
    return docs.map(toReservation);
  }

  async findProductIdsWithDueReservations(now: Date): Promise<string[]> {
    return this.collection.distinct(
      'productId',
      { status: ReservationStatus.Active, expiresAt: { $lte: now } },
      { session: this.session },
    );
  }
}

function toReservation({ _id, ...rest }: ReservationDocument): Reservation {
  return Reservation.fromSnapshot({ id: _id, ...rest });
}
