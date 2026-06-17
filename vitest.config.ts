import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['app/**/*.test.{ts,tsx}', 'cypress/support/**/*.test.ts'],
    env: { SESSION_SECRET: 'test-secret-test-secret-32-chars!!', AUTH_PROVIDER: 'fake' },
    restoreMocks: true,
  },
  resolve: { alias: { '@': new URL('./app/', import.meta.url).pathname } },
});
