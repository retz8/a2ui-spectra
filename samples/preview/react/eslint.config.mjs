import reactHooks from 'eslint-plugin-react-hooks';
import preset from '../../../eslint.preset.mjs';

export default [
  ...preset,
  {...reactHooks.configs.flat.recommended, files: ['**/*.{ts,tsx}']},
  {ignores: ['vite.config.ts']},
];
