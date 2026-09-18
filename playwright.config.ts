import { defineConfig } from '@playwright/test';

/**
 * By default tests start a local Vite dev server. When E2E_BASE_URL is set
 * (e.g. inside docker compose, pointing at the `web` service), the tests
 * run against that already-running deployment instead.
 */
const externalBase = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: externalBase ?? 'http://127.0.0.1:5173',
  },
  ...(externalBase
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
