module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Several suites hit the same local Postgres and wipe tables; parallel workers race.
  maxWorkers: 1,
  // Las suites corren contra alumbra_test, nunca contra la DB de desarrollo.
  globalSetup: '<rootDir>/test/setup/global-setup.js',
  setupFiles: ['<rootDir>/test/setup/test-env.ts'],
};
