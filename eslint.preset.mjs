import gts from 'gts';

/**
 * Shared ESLint preset across all A2UI monorepo packages.
 */
export default [
  ...gts,
  {
    rules: {
      // Decouple formatting from linting (rely strictly on Prettier for formatting)
      'prettier/prettier': 'off',
      // Common monorepo rule relaxations
      eqeqeq: ['error', 'always', {null: 'ignore'}],
      'no-undef': 'off',
      quotes: ['warn', 'single', {avoidEscape: true, allowTemplateLiterals: true}],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/lib/**',
      '**/node_modules/**',
      '**/.angular/**',
      '.wireit/**',
      '**/*.d.ts',
      '**/generated/**',
      '**/generated.ts',
    ],
  },
];
