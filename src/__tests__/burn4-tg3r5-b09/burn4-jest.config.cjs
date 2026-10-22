module.exports = {
  rootDir: '../../..',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r5-b09'],
  testEnvironment: 'node',
  testMatch: ['**/burn4-*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/src/__tests__/burn4-tg3r5-b09/burn4-tsconfig.json' }] },
};
