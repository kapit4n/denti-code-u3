// Denti-Code U3 — ESLint flat configuration.
//
// Extends the plain-JS, browser and Node presets supplied by
// `eslint-config` / `@eslint/js` (kept out of the root package.json so the
// root dependency set stays small and explicit).
//
// The domain/architecture rules that matter for this project live in
// `scripts/check-boundaries.mjs` (`pnpm run guard:boundaries`), because they
// need the *workspace import graph*, not just per-file syntax.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

/** Workspace package globs. */
const TS_PACKAGES = ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'];
const REACT_PACKAGES = ['packages/app/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'];
const NODE_PACKAGES = ['apps/api/**/*.ts', 'database/**/*.ts', 'scripts/**/*.mjs'];

const FORBIDDEN_IN_DOMAIN = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'drizzle-orm',
  'postgres',
  '@tanstack/react-query',
  '@tanstack/react-router',
  'zustand',
  'zod',
  '@denti-code-u3/ui',
  '@denti-code-u3/app',
  '@denti-code-u3/api-client',
  '@denti-code-u3/validation',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/routeTree.gen.ts',
      'apps/desktop/src-tauri/target/**',
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript everywhere in the workspace: typed linting, no `any` by default.
  {
    files: TS_PACKAGES,
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2023,
      },
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
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'error',
      'prefer-const': 'error',
    },
  },

  // The React application and the design system.
  {
    files: REACT_PACKAGES,
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-key': 'error',
      'react/self-closing-comp': 'error',
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Node-side code: the API, database tooling and scripts.
  {
    files: NODE_PACKAGES,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // THE domain layer must stay framework-independent (ADR 0004).
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: FORBIDDEN_IN_DOMAIN.map((name) => ({
            name,
            message:
              'packages/domain must stay framework-independent: it may not import ' +
              `${name} (see docs/decisions/0004-framework-independent-domain.md).`,
          })),
          patterns: [
            {
              group: ['@tauri-apps/*', '@denti-code-u3/*', 'drizzle-orm/*'],
              message:
                'packages/domain must not import framework, workspace or infrastructure packages.',
            },
          ],
        },
      ],
    },
  },

  // The database layer is the only place allowed to speak SQL / Drizzle.
  {
    files: [
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
      'apps/web/src/**/*.ts',
      'apps/desktop/src/src/**/*.ts',
    ],
    ignores: ['packages/app/src/platform/desktop.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm',
              message:
                'Only apps/api and database/ may import Drizzle. Clients go through the REST API.',
            },
            {
              name: 'postgres',
              message: 'Only apps/api may hold a database connection.',
            },
          ],
        },
      ],
    },
  },

  // Tauri APIs are reachable only through the platform adapter (ADR 0009).
  {
    files: [
      'packages/app/src/**/*.ts',
      'packages/app/src/**/*.tsx',
      'packages/ui/src/**/*.ts',
      'packages/ui/src/**/*.tsx',
      'apps/web/src/**/*.ts',
      'apps/desktop/src/**/*.ts',
    ],
    ignores: ['packages/app/src/platform/desktop.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*', '@tauri-apps/api/*'],
              message:
                'Use the platform abstraction (usePlatform) instead of Tauri APIs directly (ADR 0009).',
            },
          ],
        },
      ],
    },
  },

  // Test files may be a little looser, but still typed.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  prettierConfig,
);
