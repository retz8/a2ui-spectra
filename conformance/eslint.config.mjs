import preset from '../eslint.preset.mjs';

export default [
  ...preset,
  // The TypeScript driver is a workspace of its own, linted by its own config.
  {ignores: ['wrapper_driver/typescript/**']},
];
