const path = require('node:path');
module.exports = {
  rootDir: path.resolve(__dirname, '../../..'),
  roots: [__dirname], testEnvironment: 'jsdom', setupFiles: [], setupFilesAfterEnv: [],
  cache: false, maxWorkers: 1, testTimeout: 10000,
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'burn4-tsconfig.json') }] },
};
