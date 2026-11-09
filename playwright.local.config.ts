import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir:'./tests/e2e',testMatch:['local-*.spec.ts','channel-coupons.spec.ts','channel-margin.spec.ts','product-missing-filter.spec.ts','sales-dashboard.spec.ts'],testIgnore:'local-integration.spec.ts',fullyParallel:true,forbidOnly:true,retries:0,reporter:'list',
  outputDir:'test-results/local',use:{baseURL:'http://127.0.0.1:4182',trace:'retain-on-failure'},
  projects:[{name:'local-chromium',use:{...devices['Desktop Chrome']}}],
  webServer:{command:'npm run dev -- --port 4182 --strictPort',url:'http://127.0.0.1:4182',reuseExistingServer:false,env:{VITE_DATA_SOURCE:'local-server'}},
})
