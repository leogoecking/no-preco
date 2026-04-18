import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/scripts/**',
    '!src/jobs/cron-teste.ts',
    '!src/server.ts',
  ],
  coverageReporters: ['text', 'lcov'],
};

export default config;
