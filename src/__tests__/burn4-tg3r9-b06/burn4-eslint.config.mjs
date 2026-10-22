import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [{
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } } },
  plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooks },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error'
  }
}, {
  files: ['**/*.mjs', '**/*.cjs'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' }
}];
