import js from '@eslint/js';

export default [
  js.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module' } },
  { files: ['src/__tests__/burn4-tg3r8-b07/*.mjs'], languageOptions: { globals: { structuredClone: 'readonly' } } },
];
