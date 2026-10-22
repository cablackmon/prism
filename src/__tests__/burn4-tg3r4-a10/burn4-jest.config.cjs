module.exports = {
  rootDir: '../../..',
  testEnvironment: 'node',
  roots: [__dirname],
  testMatch: ['**/burn4-*.powershell.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true },
      diagnostics: false,
    }],
  },
};
