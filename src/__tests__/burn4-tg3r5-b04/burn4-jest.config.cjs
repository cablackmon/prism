module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r5-b04/burn4-*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/src/__tests__/burn4-tg3r5-b04/burn4-tsconfig.json' }],
  },
};
