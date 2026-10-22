import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [
  {
    files: [
      'src/app/weekend/map/**/*.ts',
      'src/app/weekend/map/**/*.tsx',
      'src/__tests__/burn4-tg3r9-b01/**/*.ts',
      'src/__tests__/burn4-tg3r9-b01/**/*.tsx',
    ],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { '@typescript-eslint': plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'no-debugger': 'error',
    },
  },
];
