import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

const recommended = plugin.configs.recommended;
if (!recommended) throw new Error('TypeScript lint rules are unavailable');

export default [
  {
    ...js.configs.recommended,
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { module: 'readonly' } },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': plugin },
    rules: {
      ...recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
