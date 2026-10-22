import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [{
  files: ['src/lib/burn4-all-day-recurrence.ts',
    'src/components/calendar/burn4-all-day-recurrence-builder.tsx',
    'src/app/calendar/recurrence/page.tsx', 'src/__tests__/burn4-tg3r9-c01/*.{ts,tsx,cjs,mjs}'],
  languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { '@typescript-eslint': plugin },
  rules: { '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-unreachable': 'error', 'no-debugger': 'error' },
}];
