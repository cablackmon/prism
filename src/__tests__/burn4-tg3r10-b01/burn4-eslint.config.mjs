import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser }, plugins: { '@typescript-eslint': plugin }, rules: { ...plugin.configs.recommended.rules, '@typescript-eslint/no-non-null-assertion': 'off' } },
  { files: ['**/*.cjs', '**/*.mjs'], languageOptions: { globals: { require: 'readonly', module: 'readonly', __dirname: 'readonly' } } },
];
