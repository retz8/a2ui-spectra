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
  {ignores: ['vite.config.ts']},
];
