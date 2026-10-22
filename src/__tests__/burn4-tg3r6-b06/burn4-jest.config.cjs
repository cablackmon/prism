module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r6-b06/burn4-*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: {
      target: 'ES2022', module: 'commonjs', esModuleInterop: true,
      strict: true, incremental: false,
    } }],
  },
};
