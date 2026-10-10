import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/unit', fullyParallel: true, forbidOnly: true, retries: 0, reporter: 'list', outputDir: 'test-results/unit', projects: [{ name: 'unit' }] })
