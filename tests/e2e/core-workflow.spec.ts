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

  await page.getByLabel('管理员名称').fill(ADMINISTRATOR.username)
  await page.getByLabel('管理员密码', { exact: true }).fill(ADMINISTRATOR.password)
  await page.getByLabel('确认密码').fill(ADMINISTRATOR.password)
  await page.getByRole('button', { name: '完成设置并进入工作台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '先处理会影响后续创作的事', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('管理员名称').fill(ADMINISTRATOR.username)
  await page.getByLabel('管理员密码', { exact: true }).fill(ADMINISTRATOR.password)
  await page.getByRole('button', { name: '登录并进入工作台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '先处理会影响后续创作的事', exact: true })).toBeVisible()
  await expect(page.locator('.app-sidebar').getByRole('link', { name: /e2e_admin/ })).toBeVisible()
  await expect(page.getByText('创作能力可用', { exact: true })).toBeVisible()

  // 四套主题只改变视觉令牌，选择结果会保存在本机并跨页面继续生效。
  await page.getByLabel('界面主题').selectOption('ocean')
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('ocean')
  await expect(page.locator('[data-theme-icon="ocean"]')).toBeVisible()
  await expect(page.locator('.theme-control')).toHaveCSS('border-top-width', '0px')
  await expect(page.locator('.app-topbar').getByText('e2e_admin', { exact: true })).toHaveCount(0)

  // 顶部不再重复提供页面搜索，页面标题也不显示面向开发者的路由代码。
  await expect(page.getByText('查找页面或功能', { exact: true })).toHaveCount(0)
  await expect(page.locator('.page-route-code')).toHaveCount(0)

  // 移动端使用抽屉导航，关闭后页面仍不能产生横向溢出。
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await page.getByRole('button', { name: '关闭导航', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })

  await page.getByText('查看完整系统状态', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '外部能力', exact: true })).toBeVisible()

  // 先创建可复用资料，再从世界详情直接关联，覆盖新的世界资料管理入口。
  await page.getByRole('link', { name: '资料库', exact: true }).click()
  await page.getByRole('button', { name: '导入资料', exact: true }).click()
  const pasteForm = page.locator('form').filter({ has: page.getByRole('button', { name: '导入粘贴文本', exact: true }) })
  await pasteForm.getByLabel('资料名称').fill('浮岛背景资料')
  await pasteForm.getByLabel('正文').fill('浮岛城市依靠风帆船往来。')
  await pasteForm.getByRole('button', { name: '导入粘贴文本', exact: true }).click()
  await expect(page.getByText('浮岛背景资料', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '世界设定', exact: true }).click()
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await page.getByLabel('世界名称').fill('浮岛纪元')
  await page.getByLabel('简短说明').fill('浮岛人物共享的背景')
  await page.getByLabel('章节正文').fill('所有城市位于浮岛，远行依赖风帆船。')
  await page.getByRole('textbox', { name: /运行摘要/ }).fill('所有城市位于浮岛，远行依赖风帆船。')
  await page.getByLabel('这次写了什么').fill('建立初始世界设定')
  await page.getByRole('button', { name: '创建世界并保存灵魂草稿', exact: true }).click()
  await page.getByRole('button', { name: '世界资料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '这个世界的参考资料', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '加入', exact: true }).click()
  await expect(page.getByText('资料已加入这个世界', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '灵魂', exact: true }).click()
  await page.getByRole('button', { name: '确认并发布', exact: true }).click()
  await expect(page.getByText('世界灵魂已发布，之后创建的新任务将使用这一版', { exact: true })).toBeVisible()

  // 创建并删除一个未发布的错误修改稿，验证草稿与已发布版本互不影响。
  await page.getByLabel('这次改了什么').fill('明显错误的修改')
  await page.getByRole('button', { name: '保存修改稿', exact: true }).click()
  await page.getByRole('button', { name: '删除修改稿', exact: true }).click()
  await expect(page.getByText('未发布的世界灵魂修改稿已删除', { exact: true })).toBeVisible()

  // 窄屏下关键区块应纵向排列，页面不能产生横向溢出。
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '新任务正在使用的灵魂', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })

  await page.getByRole('link', { name: '人物', exact: true }).click()
  await page.getByRole('link', { name: '创建人物', exact: true }).click()
  await page.getByLabel('人物名称').fill('林默')
  await page.getByLabel('章节正文').fill('严谨克制的学院观察员，关注课程、档案与古代文献，表达冷静简洁。')
  await page.getByRole('textbox', { name: /运行摘要/ }).fill('严谨克制，关注课程与档案，先核验再判断。')
  await page.getByLabel('这次建立了什么').fill('建立学院观察员灵魂')
  await page.getByRole('button', { name: '创建人物并保存灵魂草稿', exact: true }).click()
  await expect(page.getByRole('heading', { name: '林默', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '灵魂', exact: true }).click()
  await page.getByRole('button', { name: '确认并发布', exact: true }).click()
  await expect(page.getByText('灵魂已发布，之后创建的新任务将使用这一版', { exact: true })).toBeVisible()

  await page.getByRole('main').getByRole('link', { name: '新建任务', exact: true }).click()
  await page.getByLabel('任务类型').selectOption('generation')
  await page.getByLabel('使用的人物').selectOption({ label: '林默' })
  await page.getByLabel('创作要求').fill('用人物风格介绍学院课程，并输出 HTML、Markdown 和 Txt。')
  await page.getByRole('button', { name: '确认并开始规划', exact: true }).click()

  await expect(page.getByRole('heading', { name: '确认内容规划', exact: true })).toBeVisible()
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

  await page.getByRole('link', { name: '系统中心', exact: true }).click()
  await expect(page.getByRole('heading', { name: '账户安全', exact: true })).toBeVisible()
  await expect(page.getByText('当前管理员', { exact: true }).locator('..')).toContainText(ADMINISTRATOR.username)
  await expect(page.getByText('系统默认运行限制', { exact: true })).toBeVisible()
  await expect(page.getByText('最多 12 个文字块', { exact: true })).toBeVisible()
})
