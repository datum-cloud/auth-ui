import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['app/**/*.test.{ts,tsx}', 'cypress/support/**/*.test.ts'],
    env: { SESSION_SECRET: 'test-secret-test-secret-32-chars!!', AUTH_PROVIDER: 'fake' },
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 68, functions: 69, branches: 60 },
    },
  },
  resolve: { alias: { '@': new URL('./app/', import.meta.url).pathname } },
});
