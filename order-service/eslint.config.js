import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'docs/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Prettier owns formatting; this turns off ESLint rules that would fight it.
  prettier,
);
