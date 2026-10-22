import js from '@eslint/js';

export default [
  js.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module' } },
];
