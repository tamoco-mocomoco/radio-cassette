import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3456',
    headless: true,
  },
  webServer: {
    command: 'npx serve . -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: true,
  },
});
