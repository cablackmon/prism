import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
export default [{
  files: [
    'src/app/api/shopping-items/batch/route.ts',
    'src/__tests__/burn4-tg3r9-b07/*.ts',
    'src/__tests__/burn4-tg3r9-b07/*.cjs',
    'src/__tests__/burn4-tg3r9-b07/*.mjs',
  ],
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
  plugins: { '@typescript-eslint': tsPlugin },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-unreachable': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-debugger': 'error',
  },
}];
