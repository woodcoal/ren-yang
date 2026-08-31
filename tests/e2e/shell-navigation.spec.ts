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
