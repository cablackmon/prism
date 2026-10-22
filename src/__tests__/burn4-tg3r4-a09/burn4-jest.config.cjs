module.exports = {
  rootDir: '../../..',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r4-a09'],
  testEnvironment: 'node',
  testMatch: ['**/burn4-*.powershell.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r4-a09/burn4-tsconfig.json',
      diagnostics: true,
    }],
  },
};
