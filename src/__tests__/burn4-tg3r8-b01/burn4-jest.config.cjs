module.exports = {
  rootDir: '../../..',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r8-b01'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r8-b01/burn4-*.test.ts'],
  setupFiles: [],
  setupFilesAfterEnv: [],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r8-b01/burn4-tsconfig.json',
      diagnostics: true,
    }],
  },
};
