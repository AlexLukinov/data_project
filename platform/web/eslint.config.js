// Flat config for the whole workspace. Rules that encode the architecture (ADR-027):
// nothing in packages/ may import from apps/, and poker-ui may import from poker-core only.
import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.nuxt/**', '**/.output/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' } },
    rules: {
      // TypeScript resolves globals and auto-imports in <script setup>; ESLint's own table cannot.
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/max-len': 'off',
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
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
    // The spec's hard rule: poker-ui depends on poker-core only.
    files: ['packages/poker-ui/**/*.ts', 'packages/poker-ui/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/apps/**', '@poker/web', '@poker/web/**'], message: 'packages/* must not depend on the app (ADR-027).' },
            { group: ['@poker/workers', '@poker/workers/**', '@poker/importers', '@poker/importers/**'], message: 'poker-ui depends on poker-core only (spec §3.2); receive services and data through props.' },
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
      // The same size limits the Python side enforces with scripts/check_sizes.py.
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/test/**', '**/bench/**'],
    rules: { 'max-lines-per-function': 'off', 'max-lines': 'off' },
  },
  {
    files: ['**/*.config.ts', '**/*.config.js', 'apps/web/nuxt.config.ts', '**/*.d.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
