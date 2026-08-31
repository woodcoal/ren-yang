import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/** 浏览器测试专用端口，避免与默认开发端口冲突。 */
const APPLICATION_PORT = 4310
/** 本地文本模型协议替身端口。 */
const MODEL_STUB_PORT = 4311

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/playwright',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${APPLICATION_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm exec tsx tests/e2e/text-model-stub.ts',
      url: `http://127.0.0.1:${MODEL_STUB_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'pnpm build && pnpm start',
      url: `http://127.0.0.1:${APPLICATION_PORT}/api/v1/setup/status`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NUXT_DATA_DIRECTORY: resolve(process.cwd(), '.playwright-data'),
        NUXT_SESSION_PASSWORD: randomBytes(48).toString('base64url'),
        NUXT_LIMITS_MINIMUM_FREE_DISK_BYTES: '0',
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: String(APPLICATION_PORT),
      },
    },
  ],
})
