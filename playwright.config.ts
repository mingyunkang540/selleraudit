import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', testIgnore: 'supabase-mode.spec.ts', fullyParallel: true, forbidOnly: true, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4180', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: { command: 'npm run dev -- --port 4180 --strictPort', url: 'http://127.0.0.1:4180', reuseExistingServer: false },
})
