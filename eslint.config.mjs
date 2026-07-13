import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // SEC-3 / CQ-1 / PERF-8 — standing guard against stray console output in SSR source.
      // Bare console.log/.debug/.info (debug noise) are forbidden; console.error/.warn stay
      // allowed because they are real stderr diagnostics (the SSR streaming-error logging in
      // app/entry.server.tsx). The single audited stdout sink — auditSink in
      // app/server/observability.ts — carries an explicit eslint-disable. Tests are exempted below.
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    // Static-analysis specs intentionally embed console.log('[excused] …') as fixture
    // content; the no-console guard targets shipped SSR source, not test scaffolding.
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },
  // Chai property-chain assertions (`.to.be.null`, `.to.be.undefined`, etc.) are
  // side-effecting getters, not function calls.  ESLint's no-unused-expressions rule
  // cannot distinguish them from truly dead expressions, so we disable it for Cypress
  // spec files where every `expect(…).to.be.<prop>` is intentional.
  {
    files: ['cypress/**/*.cy.{ts,tsx}', 'cypress/**/*.spec.{ts,tsx}'],
    rules: { '@typescript-eslint/no-unused-expressions': 'off' },
  },
  { ignores: ['build/', '.react-router/', 'app/modules/i18n/locales/'] },
);
