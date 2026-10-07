import { unitOfWorkContract } from '../../../../test/contracts/unit-of-work.contract';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';

unitOfWorkContract('InMemoryUnitOfWork', () => Promise.resolve(new InMemoryUnitOfWork()));
