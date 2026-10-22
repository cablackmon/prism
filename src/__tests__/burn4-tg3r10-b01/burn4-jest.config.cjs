const path = require('node:path');
module.exports = {
  rootDir: path.resolve(__dirname, '../../..'),
  roots: [__dirname],
  testMatch: ['**/burn4-*.test.ts', '**/burn4-*.test.tsx'],
  testEnvironment: 'jsdom',
  setupFiles: [],
  setupFilesAfterEnv: [path.join(__dirname, 'burn4-setup.ts')],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'burn4-tsconfig.json'), diagnostics: true }] },
  moduleNameMapper: { '\\.css$': path.join(__dirname, 'burn4-style.cjs') },
};
