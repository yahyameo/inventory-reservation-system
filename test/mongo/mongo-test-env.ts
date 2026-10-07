import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MongoUnitOfWork } from '../../src/inventory/infrastructure/mongo/mongo-unit-of-work';

/**
 * A throwaway single-node replica set (transactions need a replica set).
 * Each "instance" gets its own MongoClient and its own in-process lock, as
 * separate application processes would.
 */
export class MongoTestEnvironment {
  private readonly clients: MongoClient[] = [];
  private databaseCounter = 0;

  private constructor(private readonly replSet: MongoMemoryReplSet) {}

  static async start(): Promise<MongoTestEnvironment> {
    const replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    return new MongoTestEnvironment(replSet);
  }

  /** A fresh database per call keeps tests isolated, unless a name is passed so instances share one. */
  async createUnitOfWork(dbName = this.newDatabaseName()): Promise<MongoUnitOfWork> {
    const client = await new MongoClient(this.replSet.getUri()).connect();
    this.clients.push(client);
    const unitOfWork = new MongoUnitOfWork(client, client.db(dbName));
    await unitOfWork.initialize();
    return unitOfWork;
  }

  newDatabaseName(): string {
    return `inventory_test_${++this.databaseCounter}`;
  }

  async stop(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.close()));
    await this.replSet.stop();
  }
}
