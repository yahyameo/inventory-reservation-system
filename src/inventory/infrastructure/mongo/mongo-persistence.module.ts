import { DynamicModule, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { UNIT_OF_WORK } from '../../application/ports/unit-of-work';
import { MongoUnitOfWork } from './mongo-unit-of-work';

const MONGO_CLIENT = Symbol('MONGO_CLIENT');

@Injectable()
class MongoConnectionLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

@Module({})
export class MongoPersistenceModule {
  static forRoot(options: { url: string; dbName: string }): DynamicModule {
    return {
      module: MongoPersistenceModule,
      providers: [
        {
          provide: MONGO_CLIENT,
          useFactory: () => new MongoClient(options.url).connect(),
        },
        {
          provide: UNIT_OF_WORK,
          inject: [MONGO_CLIENT],
          useFactory: async (client: MongoClient) => {
            const unitOfWork = new MongoUnitOfWork(client, client.db(options.dbName));
            await unitOfWork.initialize();
            return unitOfWork;
          },
        },
        MongoConnectionLifecycle,
      ],
      exports: [UNIT_OF_WORK],
    };
  }
}
