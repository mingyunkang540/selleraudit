import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'supabase-mode.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/supabase',
  use: { baseURL: 'http://127.0.0.1:4181', trace: 'retain-on-failure' },
  projects: [{ name: 'supabase-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: 'node scripts/dev-supabase-test.mjs',
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: false,
  },
})
