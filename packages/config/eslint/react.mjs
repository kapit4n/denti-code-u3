/** Shared ESLint flat config for React packages: `packages/ui`, `packages/app`. */
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export const reactRules = {
  ...react.configs.flat.recommended.rules,
  'react/react-in-jsx-scope': 'off',
  'react/prop-types': 'off',
  'react/jsx-key': 'error',
  'react/self-closing-comp': 'error',
  ...reactHooks.configs.recommended.rules,
};
