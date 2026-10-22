import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [{
  files: ['src/lib/burn4-recurring-task.ts', 'src/components/tasks/burn4-recurring-task-completion.tsx',
    'src/__tests__/burn4-tg3r9-b04/**/*.ts', 'src/__tests__/burn4-tg3r9-b04/**/*.tsx',
    'src/__tests__/burn4-tg3r9-b04/**/*.cjs', 'src/__tests__/burn4-tg3r9-b04/**/*.mjs'],
  languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
  plugins: { '@typescript-eslint': plugin },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    'no-unreachable': 'error', 'no-constant-condition': 'error', 'eqeqeq': 'error',
  },
}];
