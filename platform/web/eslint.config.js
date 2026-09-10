// Flat config for the whole workspace. Rules that encode the architecture (ADR-027):
// nothing in packages/ may import from apps/, and poker-ui may import from poker-core only.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.nuxt/**', '**/.output/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.ts', 'packages/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/apps/**', '@poker/web', '@poker/web/**'], message: 'packages/* must not depend on the app (ADR-027).' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // Named exports only (global convention); default exports are allowed in Vue SFCs and configs.
      'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.config.ts', '**/*.config.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
