module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r7-c03/burn4-*.pglite.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r7-c03/burn4-tsconfig.json',
    }],
  },
  testTimeout: 30000,
};
