import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [{
  files: ['src/lib/burn4-font-scale.ts', 'src/components/accessibility/burn4-font-scale-controls.tsx', 'src/__tests__/burn4-tg3r9-b05/*.{ts,tsx,mjs,cjs}'],
  languageOptions: { parser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' }, globals: { module: 'readonly', require: 'readonly', __dirname: 'readonly' } },
  plugins: { '@typescript-eslint': plugin },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    'eqeqeq': 'error',
    'no-eval': 'error',
    'no-unreachable': 'error',
  },
}];
