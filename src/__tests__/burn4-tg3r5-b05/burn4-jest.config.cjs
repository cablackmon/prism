/** @type {import('jest').Config} */
module.exports = {
  rootDir: '../../..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r5-b05'],
  testMatch: ['**/burn4-*.test.ts'],
  setupFiles: [],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
      },
      diagnostics: false,
    }],
  },
};
