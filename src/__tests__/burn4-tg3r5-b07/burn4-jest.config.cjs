module.exports = {
  rootDir: '../../..',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r5-b07'],
  testEnvironment: 'node',
  testMatch: ['**/burn4-*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r5-b07/burn4-tsconfig.json',
      diagnostics: true,
    }],
  },
};
