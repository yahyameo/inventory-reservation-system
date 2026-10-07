import { DynamicModule, Module } from '@nestjs/common';
import { StorageConfig } from '../../../config/app-config';
import { UNIT_OF_WORK } from '../../application/ports/unit-of-work';
import { InMemoryUnitOfWork } from '../memory/in-memory-unit-of-work';
import { MongoPersistenceModule } from '../mongo/mongo-persistence.module';

/**
 * Chooses the storage adapter behind the UNIT_OF_WORK port. Application code
 * depends only on the port, so swapping adapters needs no other change.
 */
@Module({})
export class PersistenceModule {
  static forRoot(storage: StorageConfig): DynamicModule {
    if (storage.driver === 'mongo') {
      return {
        module: PersistenceModule,
        imports: [MongoPersistenceModule.forRoot(storage)],
        exports: [MongoPersistenceModule],
      };
    }
    return {
      module: PersistenceModule,
      providers: [{ provide: UNIT_OF_WORK, useFactory: () => new InMemoryUnitOfWork() }],
      exports: [UNIT_OF_WORK],
    };
  }
}
