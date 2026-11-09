import { defineConfig,devices } from '@playwright/test'
export default defineConfig({
  testDir:'./tests/e2e',testMatch:'local-integration.spec.ts',forbidOnly:true,retries:0,reporter:'list',
  outputDir:'test-results/local-integration',use:{baseURL:'http://127.0.0.1:5184',trace:'retain-on-failure'},
  projects:[{name:'local-integration',use:{...devices['Desktop Chrome']}}],
  webServer:[
    {command:'node --experimental-strip-types server/tests/local_e2e_server.mjs',url:'http://127.0.0.1:4189/api/health',reuseExistingServer:false,timeout:60000},
    {command:'npm run dev -- --config vite.local.integration.config.ts --port 5184 --strictPort',url:'http://127.0.0.1:5184',reuseExistingServer:false,env:{VITE_DATA_SOURCE:'local-server'}},
  ],
})
