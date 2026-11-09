import { defineConfig, devices } from '@playwright/test';

/**
 * Browser layout and visual assertions against the production server.
 * Prefer geometry checks; use pixel baselines for visual specifications.
 */
const PORT = 3200;

export default defineConfig({
  testDir: './__tests__/visual',
  // Layout assertions must not race a still-hydrating page; retry once locally
  // rather than encoding sleeps into the tests.
  retries: process.env.CI ? 2 : 1,
  // Serial: every test shares one dev server and one demo society, and parallel
  // workers mutating the same seeded data is a flake source, not a speedup.
  workers: 1,
  reporter: [['list']],
  use: {
    // Keep one localhost origin throughout so the demo cookie and hydration
    // chunks are not split between localhost and 127.0.0.1.
    baseURL: `http://localhost:${PORT}`,
    // Animations settle before any measurement is taken.
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      // Font antialiasing differs between machines even at identical viewport
      // sizes; a small tolerance keeps a real regression visible without
      // failing on a rendering nicety.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    // The production build must already exist. This deliberately refuses to
    // fall back to development, whose relaxed CSP can conceal release defects.
    command: `npx next start --port ${PORT}`,
    // Wait for the public login route before running browser assertions.
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
