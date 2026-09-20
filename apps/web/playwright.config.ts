import { defineConfig, devices } from '@playwright/test';

// One smoke test, driving the real built stack (`jev serve`) against a
// stubbed upstream (see e2e/fixtures.ts + e2e/stub-upstream.mjs) — never the
// real TypeSafe API. `workers: 1` because the fixtures bind one fixed port
// (4273) and one child server process per run.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
