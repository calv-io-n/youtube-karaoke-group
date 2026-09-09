import { defineConfig } from '@playwright/test';
import { resolveDevOrigin } from './scripts/dev-origin.mjs';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 60_000,
  use: { baseURL: resolveDevOrigin() },
  webServer: { command: 'npm run dev:gate', url: resolveDevOrigin(), reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
