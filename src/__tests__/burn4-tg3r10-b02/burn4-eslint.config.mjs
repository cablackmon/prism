import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: process.cwd(), resolvePluginsRelativeTo: process.cwd() });
export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { ignores: ['node_modules/**'] },
];
