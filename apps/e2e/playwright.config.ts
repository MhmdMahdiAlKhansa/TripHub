import { defineConfig } from '@playwright/test';

/**
 * Browser tests run against already-running servers (see README "Verify"): API on :4000 and web on :3000,
 * with the demo data from `corepack pnpm --filter @triphub/api seed`. They use the system Edge/Chrome
 * (no browser download) via E2E_CHANNEL (default msedge).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: process.env.E2E_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
  },
});
