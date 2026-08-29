import { expect, test, type Page } from '@playwright/test'

const ADMINISTRATOR = {
  username: 'e2e_admin',
  password: 'e2e-password-12345',
}

/**
 * 等待 SSR 页面完成 Vue 水合，避免表单在事件接管前执行原生提交。
 * @param page 当前浏览器页面。
 * @returns Nuxt 根节点挂载 Vue 应用后结束。
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(
    (document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null)?.__vue_app__,
  ))
}

/**
 * 下载当前页面中的指定格式产物并确认服务端返回文件。
 * @param page 当前浏览器页面。
 * @param label 下载按钮的可见名称。
 * @param extension 预期文件扩展名。
 * @returns 文件名与字节流校验结束时完成。
 */
async function downloadArtifact(page: Page, label: string, extension: string): Promise<void> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: label, exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`))
  expect(await download.createReadStream()).not.toBeNull()
}

test('首次设置、人物发布、文档确认及三格式导出形成可复现闭环', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await waitForHydration(page)

  await page.getByLabel('管理员用户名').fill(ADMINISTRATOR.username)
  await page.getByLabel('管理员密码', { exact: true }).fill(ADMINISTRATOR.password)
  await page.getByLabel('确认密码').fill(ADMINISTRATOR.password)
  await page.getByRole('button', { name: '创建管理员', exact: true }).click()
  await expect(page.getByRole('heading', { name: '仪表盘', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('用户名').fill(ADMINISTRATOR.username)
  await page.getByLabel('密码', { exact: true }).fill(ADMINISTRATOR.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '仪表盘', exact: true })).toBeVisible()
  await expect(page.getByLabel('账户与系统状态')).toContainText('e2e_admin')
  await expect(page.getByLabel('账户与系统状态')).toContainText('文本可用')
  await expect(page.getByRole('heading', { name: '外部能力', exact: true })).toBeVisible()

  await page.getByRole('link', { name: '人物', exact: true }).click()
  await page.getByRole('link', { name: '创建人物', exact: true }).click()
  await page.getByLabel('人物名称').fill('林默')
  await page.getByLabel('人物定位').fill('严谨克制的学院观察员')
  await page.getByLabel('兴趣偏好').fill('课程、档案与古代文献')
  await page.getByLabel('表达风格').fill('冷静、简洁、先核验再判断')
  await page.getByRole('button', { name: '保存候选人物', exact: true }).click()
  await expect(page.getByRole('heading', { name: '林默', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect(page.getByText('候选版本已发布', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '创作', exact: true }).click()
  await page.getByLabel('任务类型').selectOption('generation')
  await page.getByLabel('已发布人物').selectOption({ label: '林默' })
  await page.getByLabel('创作要求').fill('用人物风格介绍学院课程，并输出 HTML、Markdown 和 Txt。')
  await page.getByRole('button', { name: '生成文档规格', exact: true }).click()

  await expect(page.getByRole('heading', { name: '确认文档规格', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存并确认执行', exact: true }).click()
  await expect(page.getByText('规格已确认，图文块已进入执行队列', { exact: true })).toBeVisible()

  await expect(page.getByRole('heading', { name: '安全预览与导出', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '生成安全预览', exact: true }).click()
  await expect(page.getByTitle('HTML 沙箱预览')).toBeVisible()
  await expect(page.getByTitle('HTML 沙箱预览').contentFrame()
    .getByRole('heading', { name: '学院观察', exact: true, level: 1 })).toBeVisible()

  await downloadArtifact(page, '下载 HTML', 'html')
  await downloadArtifact(page, '下载 Markdown', 'md')
  await downloadArtifact(page, '下载 TXT', 'txt')

  await page.getByRole('link', { name: '系统设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '账户安全', exact: true })).toBeVisible()
  await expect(page.getByText('当前管理员', { exact: true }).locator('..')).toContainText(ADMINISTRATOR.username)
  await expect(page.getByText('系统默认运行限制', { exact: true })).toBeVisible()
  await expect(page.getByText('最多 12 个文字块', { exact: true })).toBeVisible()
})
