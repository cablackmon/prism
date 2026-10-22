module.exports = {
  rootDir: '../../..',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r8-b02'],
  testEnvironment: 'jest-environment-jsdom',
  testEnvironmentOptions: { customExportConditions: ['node', 'node-addons'] },
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r8-b02/burn4-*.test.ts', '<rootDir>/src/__tests__/burn4-tg3r8-b02/burn4-*.test.tsx'],
  setupFiles: [],
  setupFilesAfterEnv: [],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r8-b02/burn4-tsconfig.json',
      diagnostics: true,
    }],
  },
};
