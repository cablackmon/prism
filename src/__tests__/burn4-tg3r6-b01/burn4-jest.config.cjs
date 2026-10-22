module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r6-b01/burn4-*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r6-b01/burn4-tsconfig.json',
    }],
  },
  testTimeout: 30000,
};
