import reactHooks from 'eslint-plugin-react-hooks';
import preset from '../../eslint.preset.mjs';

export default [
  ...preset,
  {...reactHooks.configs.flat.recommended, files: ['**/*.{ts,tsx}']},
  {
    // The test configuration covers every file in src/, the tests and their helpers included.
    files: ['**/*.{ts,tsx}'],
    languageOptions: {parserOptions: {project: './tsconfig.test.json'}},
  },
  {
    // An effect's arrow without braces returns its expression as the cleanup, and a DOM method
    // that returns a promise, as scrollIntoView does in Chrome 155, then crashes React.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^use(Layout)?Effect$/] > ArrowFunctionExpression[body.type!='BlockStatement']",
          message:
            "Write the effect's body in braces, so the effect returns only a cleanup it means to.",
        },
      ],
    },
  },
  {ignores: ['vite.config.ts']},
];
