const path = require('path');

module.exports = {
  rootDir: path.resolve(__dirname, '../../..'),
  roots: [__dirname],
  testEnvironment: 'jsdom',
  testMatch: ['**/burn4-*.test.ts', '**/burn4-*.test.tsx'],
  setupFiles: [],
  setupFilesAfterEnv: [],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'burn4-tsconfig.json'), diagnostics: true }],
  },
  clearMocks: true,
};
