module.exports = {
  rootDir: `${__dirname}/../../..`,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r5-b02/burn4-*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r5-b02/burn4-tsconfig.json',
      diagnostics: true,
    }],
  },
  cacheDirectory: '<rootDir>/.cache/burn4-tg3r5-b02-jest',
};
