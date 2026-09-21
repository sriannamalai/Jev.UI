import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Dot-directories at the repository root are local tooling state, never source.
    ignores: ['**/dist/**', '**/coverage/**', '.*/**'],
  },
  ...tseslint.configs.recommended,
);
