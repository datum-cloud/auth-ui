import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression config for ceremony screens.
 *
 * Captures baseline screenshots at 4 breakpoints (320 / 768 / 1024 / 1440)
 * against a locally-running app served under the `/id` basename. Used as the
 * `bun run test:visual` gate for the `AuthCeremony` adoption work.
 */

const BASE_URL = 'http://localhost:3000/id';

const BREAKPOINTS = [320, 768, 1024, 1440] as const;

export default defineConfig({
  testDir: './visual',
  snapshotDir: './visual/__screenshots__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
  },
  expect: {
    toHaveScreenshot: {
      threshold: 0.01,
    },
  },
  projects: BREAKPOINTS.map((width) => ({
    name: `w${width}`,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width, height: 900 },
    },
  })),
});
