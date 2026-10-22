module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r7-b04/burn4-*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { target: 'ES2022', module: 'commonjs', esModuleInterop: true }, diagnostics: true }] },
};
