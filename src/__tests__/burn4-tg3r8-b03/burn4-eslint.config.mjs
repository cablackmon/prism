import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly' },
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },
];
