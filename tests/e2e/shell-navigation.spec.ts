import { expect, test, type Page } from '@playwright/test'

/** 浏览器壳层测试使用的稳定本机管理员。 */
const ADMINISTRATOR = {
  username: 'e2e_admin',
  password: 'e2e-password-12345',
}

/**
 * 等待 Nuxt 完成客户端水合。
 * @param page 当前浏览器页面。
 * @returns 根应用具备 Vue 实例后结束。
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(
    (document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null)?.__vue_app__,
  ))
}

/**
 * 兼容独立运行与全套运行，完成首次设置或现有管理员登录。
 * @param page 当前浏览器页面。
 * @returns 已进入后台首页时结束。
 */
async function enterApplication(page: Page): Promise<void> {
  await page.goto('/')
  await waitForHydration(page)
  if (page.url().endsWith('/setup')) {
    await page.getByLabel('管理员名称').fill(ADMINISTRATOR.username)
    await page.getByLabel('管理员密码', { exact: true }).fill(ADMINISTRATOR.password)
    await page.getByLabel('确认密码').fill(ADMINISTRATOR.password)
    await page.getByRole('button', { name: '完成设置并进入工作台', exact: true }).click()
  }
  else if (page.url().endsWith('/login')) {
    await page.getByLabel('管理员名称').fill(ADMINISTRATOR.username)
    await page.getByLabel('管理员密码', { exact: true }).fill(ADMINISTRATOR.password)
    await page.getByRole('button', { name: '登录并进入工作台', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: '先处理会影响后续创作的事', exact: true })).toBeVisible()
}

test('侧栏分组可收缩、滚动条隐藏且页面具有浏览器标题', async ({ page }) => {
  await enterApplication(page)
  await expect(page).toHaveTitle(/ - 人样$/)

  const navigation = page.getByRole('navigation', { name: '主导航' })
  const workbenchToggle = navigation.getByRole('button', { name: '工作台', exact: true })
  const personaToggle = navigation.getByRole('button', { name: '人物空间', exact: true })
  const systemToggle = navigation.getByRole('button', { name: '系统', exact: true })
  await expect(workbenchToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(personaToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(systemToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByRole('link', { name: '人物', exact: true })).toBeHidden()

  await personaToggle.click()
  await expect(personaToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: '人物', exact: true })).toBeVisible()
  await personaToggle.click()
  await expect(personaToggle).toHaveAttribute('aria-expanded', 'false')

  await expect(page.locator('.app-sidebar')).toHaveCSS('overflow', 'hidden')
  await expect(page.locator('.sidebar-navigation')).toHaveCSS('overflow-y', 'auto')
  await expect(page.locator('.sidebar-navigation')).toHaveCSS('scrollbar-width', 'none')
})

test('顶部队列只显示尚未领取的有效待处理数量', async ({ page }) => {
  await enterApplication(page)

  // 模拟健康摘要中同时存在排队、执行中和取消中的任务，验证顶部不会显示未终止任务总数。
  await page.route('**/api/v1/system/health', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          healthy: true,
          setupRequired: false,
          database: { healthy: true, journalMode: 'wal', foreignKeysEnabled: true, integrity: 'ok' },
          worker: { running: true, activeJobId: 'running-job', lastPollAt: Date.now(), lastError: null },
          taskQueue: { userQueued: 2, queued: 12, running: 3, cancelRequested: 1, total: 16 },
        },
      }),
    })
  })

  await page.waitForResponse(response => response.url().endsWith('/api/v1/system/health'))
  await expect(page.locator('.topbar-status-link')).toHaveText('2 项待处理')
  await expect(page.locator('.topbar-status-dot')).toHaveClass(/topbar-status-dot--active/)
})

test('任务列表直接显示失败原因', async ({ page }) => {
  await enterApplication(page)

  // 使用稳定的失败任务响应核验列表呈现，避免依赖外部模型实际失败。
  await page.route('**/api/v1/history**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [{
            sourceType: 'run', id: '70000000-0000-4000-8000-000000000001', kind: 'artifact_generation',
            subjectType: 'persona', subjectId: '10000000-0000-4000-8000-000000000001', subjectName: '林默',
            subjectExists: true, status: 'failed', description: '生成一篇人物小传', secondary: '测试模型',
            errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: '模型服务暂时不可用', createdAt: 1_000,
          }],
          total: 1, page: 1, pageSize: 10, totalPages: 1,
        },
      }),
    })
  })

  await page.getByRole('link', { name: '任务记录', exact: true }).click()
  await expect(page).toHaveURL(/\/history/)
  await expect(page.getByText('PROVIDER_UNAVAILABLE：模型服务暂时不可用', { exact: true })).toBeVisible()
})
