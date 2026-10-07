/**
 * Three Jest projects so each suite can be run on its own:
 *  - unit:  domain, application and in-memory infrastructure (fast, no I/O)
 *  - mongo: MongoDB adapter against an in-process replica set (mongodb-memory-server)
 *  - e2e:   HTTP API through the full Nest application
 */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
};

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'mongo',
      testMatch: ['<rootDir>/test/mongo/**/*.spec.ts'],
      testTimeout: 120_000,
    },
    { ...base, displayName: 'e2e', testMatch: ['<rootDir>/test/e2e/**/*.spec.ts'] },
  ],
};
