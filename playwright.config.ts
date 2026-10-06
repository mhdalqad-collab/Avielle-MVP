import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',testMatch:'*.spec.ts',timeout:120_000,workers:1,fullyParallel:false,
  reporter:[['list']],outputDir:'test-results',
  use:{baseURL:'http://localhost:3000',headless:true,channel:process.env.CI?undefined:'msedge',actionTimeout:20_000,navigationTimeout:30_000,screenshot:'only-on-failure',trace:'retain-on-failure'},
});
