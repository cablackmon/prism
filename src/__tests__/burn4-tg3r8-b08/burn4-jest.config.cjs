module.exports = {
  rootDir: '../../..',
  roots: ['<rootDir>/src/__tests__/burn4-tg3r8-b08'],
  testEnvironment: 'jest-environment-jsdom',
  testEnvironmentOptions: { customExportConditions: ['node', 'node-addons'] },
  testMatch: ['<rootDir>/src/__tests__/burn4-tg3r8-b08/burn4-layout-expander.test.tsx'],
  setupFiles: [],
  setupFilesAfterEnv: [],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/src/__tests__/burn4-tg3r8-b08/burn4-tsconfig.json',
      diagnostics: true,
    }],
  },
};
