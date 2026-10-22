module.exports = {
  rootDir: '../../..', roots: ['<rootDir>/src/__tests__/burn4-tg3r8-c01'],
  testEnvironment: 'jest-environment-jsdom',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r8-c01/burn4-*.test.ts', '<rootDir>/src/__tests__/burn4-tg3r8-c01/burn4-*.test.tsx'],
  setupFiles: [], setupFilesAfterEnv: [],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: {
    target: 'ES2022', module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx',
    strict: true, noUncheckedIndexedAccess: true, esModuleInterop: true, types: ['node', 'jest', 'react'],
  }, diagnostics: true }] },
};
