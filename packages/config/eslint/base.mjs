/**
 * Shared ESLint flat config for framework-independent Denti-Code U3 packages
 * (`packages/types`, `packages/domain`, `packages/validation`,
 * `packages/api-client`).
 *
 * The architecture rules that depend on the workspace import graph live in
 * `scripts/check-boundaries.mjs`, because per-file linting cannot see them.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export const TS_FILES = ['src/**/*.ts', 'src/**/*.tsx'];

export function baseConfig(extraFiles = []) {
  return tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: [...TS_FILES, ...extraFiles],
      languageOptions: {
        parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
        globals: { ...globals.es2023 },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-explicit-any': 'warn',
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'prefer-const': 'error',
      },
    },
    prettierConfig,
  );
}

export default baseConfig();
