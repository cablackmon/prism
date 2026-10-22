export default [{
  files: ['scripts/burn4-trip-route-geometry.mjs', 'src/__tests__/burn4-tg3r9-b03/*.mjs'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    'no-unreachable': 'error',
    'no-constant-condition': 'error',
    'no-dupe-keys': 'error',
    'eqeqeq': 'error',
  },
}];
