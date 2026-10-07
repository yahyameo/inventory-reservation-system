/**
 * Starts a throwaway single-node MongoDB replica set for local development
 * (transactions need a replica set). Prints the connection string and keeps
 * running until Ctrl+C.
 *
 *   npm run mongo:dev
 *   STORAGE_DRIVER=mongo MONGO_URL="<printed uri>" npm run start:dev
 */
const { MongoMemoryReplSet } = require('mongodb-memory-server');

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  console.log(`MongoDB replica set ready:\n  MONGO_URL="${replSet.getUri()}"`);

  const shutdown = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
