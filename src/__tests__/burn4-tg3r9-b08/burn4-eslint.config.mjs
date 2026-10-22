import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [{ files: ['src/lib/burn4-freeform-layout.ts', 'src/components/layout/burn4-freeform-layout-editor.tsx', 'src/__tests__/burn4-tg3r9-b08/*.{ts,tsx,cjs,mjs}'],
  languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { '@typescript-eslint': plugin }, rules: { '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    'no-debugger': 'error', 'no-constant-condition': 'error' } }];
