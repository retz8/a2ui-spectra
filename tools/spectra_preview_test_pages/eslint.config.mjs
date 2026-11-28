import reactHooks from 'eslint-plugin-react-hooks';
import preset from '../../eslint.preset.mjs';

export default [
  ...preset,
  {...reactHooks.configs.flat.recommended, files: ['react/**/*.{ts,tsx}']},
  // The Angular page is type checked by its own project, which Angular's builder reads.
  {
    files: ['angular/**/*.ts'],
    languageOptions: {parserOptions: {project: './tsconfig.angular.json'}},
  },
  {ignores: ['vite.config.ts']},
];
