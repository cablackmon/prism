module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  setupFiles: [],
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r6-b07/burn4-tsconfig.json',
      diagnostics: true,
    }],
  },
};
