const path = require('node:path');

module.exports = {
  rootDir: path.resolve(__dirname, '../../..'),
  testEnvironment: 'jsdom',
  roots: [path.join(__dirname)],
  cache: false,
  maxWorkers: 1,
  testTimeout: 10000,
  setupFiles: [],
  setupFilesAfterEnv: [],
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r9-b06/burn4-*.test.ts', '<rootDir>/src/__tests__/burn4-tg3r9-b06/burn4-*.test.tsx'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'burn4-tsconfig.json'), diagnostics: true }] },
  clearMocks: true,
  restoreMocks: true,
};
