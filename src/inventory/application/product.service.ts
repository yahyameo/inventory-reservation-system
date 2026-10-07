import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ProductNotFoundError } from '../domain/errors';
import { Product } from '../domain/product';
import { CLOCK, Clock } from './ports/clock';
import { UNIT_OF_WORK, UnitOfWork } from './ports/unit-of-work';
import { ReservationExpiryService } from './reservation-expiry.service';

export interface CreateProductCommand {
  name: string;
  totalStock: number;
}

@Injectable()
export class ProductService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly expiry: ReservationExpiryService,
  ) {}

  async create(command: CreateProductCommand): Promise<Product> {
    const product = Product.create({ id: randomUUID(), ...command });
    await this.unitOfWork.runExclusive(product.id, (repositories) =>
      repositories.products.save(product),
    );
    return product;
  }

  /** Returns the product with up-to-date availability: lapsed holds are released first. */
  get(productId: string): Promise<Product> {
    return this.unitOfWork.runExclusive(productId, async (repositories) => {
      const product = await repositories.products.findById(productId);
      if (!product) throw new ProductNotFoundError(productId);
      await this.expiry.releaseDue(repositories, product, this.clock.now());
      return product;
    });
  }
}
