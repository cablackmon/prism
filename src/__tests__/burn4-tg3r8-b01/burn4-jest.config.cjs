module.exports = {
  rootDir: '../../..',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r8-b01'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r8-b01/burn4-*.test.ts'],
  setupFiles: [],
  setupFilesAfterEnv: [],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        noUncheckedIndexedAccess: true,
        esModuleInterop: true,
        types: ['node', 'jest'],
        skipLibCheck: true,
      },
      diagnostics: true,
    }],
  },
};
