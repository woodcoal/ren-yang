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
 * 通过已认证后台接口写入浏览器测试专用文本模型，并绑定全部文本算法。
 * @param page 已完成管理员设置且持有会话 Cookie 的页面。
 * @returns 数据库 AI 配置全部发布完成时结束。
 */
async function configureTestAi(page: Page): Promise<void> {
  /**
   * 从当前页面发起同源已认证请求，确保使用浏览器刚由首次设置写入的会话 Cookie。
   * @param path 后台接口路径。
   * @param method HTTP 方法。
   * @param body 可选 JSON 正文。
   * @returns 解析后的统一响应 data。
   */
  async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<T> {
    const response = await page.evaluate(async (input) => {
      const result = await fetch(input.path, {
        method: input.method,
        credentials: 'same-origin',
        headers: input.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      })
      return { ok: result.ok, status: result.status, text: await result.text() }
    }, { path, method, body })
    if (!response.ok) throw new Error(`浏览器测试后台配置失败（HTTP ${response.status}）：${response.text}`)
    return (JSON.parse(response.text) as { data: T }).data
  }

  const connection = await request<{ id: string }>('/api/v1/ai/connections', 'POST', {
    name: '浏览器测试接口', protocol: 'openai_compatible',
    endpoint: 'http://127.0.0.1:4311/v1', userAgent: 'RenYang-E2E/1.0',
    apiKey: 'e2e-placeholder', isEnabled: true,
  })
  const deployment = await request<{ id: string }>('/api/v1/ai/model-deployments', 'POST', {
    connectionId: connection.id, name: '浏览器测试文本模型',
    model: 'e2e-text-model', modality: 'text', isEnabled: true,
  })

  const algorithms = await request<Array<{ code: string, stepDefinitions: Array<{ key: string, modality: 'text' | 'image' }> }>>('/api/v1/ai/algorithms', 'GET')
  for (const algorithm of algorithms) {
    if (algorithm.stepDefinitions.some(step => step.modality !== 'text')) continue
    await request(`/api/v1/ai/algorithms/${algorithm.code}`, 'PUT', {
      steps: algorithm.stepDefinitions.map(step => ({
        stepKey: step.key,
        modelDeploymentId: deployment.id,
        parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      })),
    })
  }
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

/**
 * 使用一次性 API Key 验证公共图文运行的创建、幂等复用、查询、渲染和下载闭环。
 * @param page 已登录管理员且后台模型与文章算法均已配置的浏览器页面。
 * @param personaId 已发布灵魂的人物 UUID。
 * @returns 公共纯文本运行完成且导出响应通过校验时结束。
 * @remarks 只调用浏览器测试模型替身，不触发真实收费模型。
 */
async function verifyPublicGenerationApi(page: Page, personaId: string): Promise<void> {
  const keyResponse = await page.evaluate(async () => {
    const response = await fetch('/api/v1/api-keys', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '浏览器测试图文接口', scopes: ['generation:read', 'generation:write'], expiresAt: null }),
    })
    return { status: response.status, text: await response.text() }
  })
  expect(keyResponse.status).toBe(201)
  const keyPayload = JSON.parse(keyResponse.text) as { data: { secret: string } }
  const authorization = `Bearer ${keyPayload.data.secret}`
  const creationRequest = {
    headers: { authorization, 'idempotency-key': 'e2e-public-generation-create-001' },
    data: { personaId, requirement: '用人物风格简要介绍学院课程。', outputFormat: 'text', imageCount: 0 },
  }

  const createResponse = await page.request.post('/api/v2/generation-runs', creationRequest)
  expect(createResponse.status()).toBe(202)
  const created = await createResponse.json() as { data: { runId: string }, meta: { requestId: string, idempotencyReplayed: boolean } }
  expect(created.meta).toMatchObject({ requestId: expect.any(String), idempotencyReplayed: false })

  const replayResponse = await page.request.post('/api/v2/generation-runs', creationRequest)
  expect(replayResponse.status()).toBe(202)
  await expect(replayResponse.json()).resolves.toMatchObject({
    data: { runId: created.data.runId },
    meta: { idempotencyReplayed: true },
  })

  await expect.poll(async () => {
    const response = await page.request.get(`/api/v2/runs/${created.data.runId}`, { headers: { authorization } })
    expect(response.status()).toBe(200)
    const payload = await response.json() as { data: { run: { status: string } } }
    return payload.data.run.status
  }, { timeout: 30_000 }).toBe('succeeded')

  const detailResponse = await page.request.get(`/api/v2/runs/${created.data.runId}`, { headers: { authorization } })
  const details = await detailResponse.json() as { data: { run: { createdAt: string } } }
  expect(details.data.run.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

  const listResponse = await page.request.get('/api/v2/runs?kind=artifact_generation&limit=10', { headers: { authorization } })
  expect(listResponse.status()).toBe(200)
  await expect(listResponse.json()).resolves.toMatchObject({
    data: expect.arrayContaining([expect.objectContaining({ id: created.data.runId })]),
  })

  const renderResponse = await page.request.post(`/api/v2/runs/${created.data.runId}/render`, {
    headers: { authorization, 'idempotency-key': 'e2e-public-generation-render-001' },
    data: { formats: ['txt'] },
  })
  expect(renderResponse.status()).toBe(200)
  await expect(renderResponse.json()).resolves.toMatchObject({ data: { runId: created.data.runId, documents: { txt: expect.stringContaining('学院观察') } } })

  const exportResponse = await page.request.get(`/api/v2/runs/${created.data.runId}/exports/txt`, { headers: { authorization } })
  expect(exportResponse.status()).toBe(200)
  expect(exportResponse.headers()['content-type']).toContain('text/plain')
  expect(exportResponse.headers()['x-request-id']).toBeTruthy()
  expect(await exportResponse.text()).toContain('学院观察')

  const synchronousGenerationRequest = {
    headers: { authorization, 'idempotency-key': 'e2e-public-generation-sync-001' },
    data: { personaId, requirement: '同步生成学院简介。', outputFormat: 'text', imageCount: 0, waitTimeoutMs: 30_000 },
  }
  const synchronousGenerationResponse = await page.request.post('/api/v2/generation-runs/sync', synchronousGenerationRequest)
  expect(synchronousGenerationResponse.status()).toBe(200)
  const synchronousGeneration = await synchronousGenerationResponse.json() as {
    data: { details: { run: { id: string } } }
    meta: { idempotencyReplayed: boolean }
  }
  expect(synchronousGeneration).toMatchObject({
    data: {
      mode: 'completed',
      details: { run: { status: 'succeeded' } },
      result: { documents: { txt: expect.stringContaining('学院观察') } },
    },
  })
  const synchronousGenerationReplay = await page.request.post('/api/v2/generation-runs/sync', synchronousGenerationRequest)
  expect(synchronousGenerationReplay.status()).toBe(200)
  await expect(synchronousGenerationReplay.json()).resolves.toMatchObject({
    data: { details: { run: { id: synchronousGeneration.data.details.run.id } } },
    meta: { idempotencyReplayed: true },
  })

  const synchronousInterestResponse = await page.request.post('/api/v2/interest-batches/sync', {
    headers: { authorization, 'idempotency-key': 'e2e-public-interest-sync-001' },
    data: {
      personaId,
      items: [{ itemId: 'course', text: '学院课程是否值得关注？' }, { itemId: 'archive', text: '古代文献整理是否有吸引力？' }],
      waitTimeoutMs: 30_000,
    },
  })
  expect(synchronousInterestResponse.status()).toBe(200)
  await expect(synchronousInterestResponse.json()).resolves.toMatchObject({
    data: {
      mode: 'completed',
      batch: {
        status: 'completed',
        items: [{ itemId: 'course', status: 'succeeded' }, { itemId: 'archive', status: 'succeeded' }],
      },
    },
  })
}

/** 学习提示词浏览器闭环的稳定文本和反馈。 */
interface LearningPromptFlowOptions {
  /** 当前可见的世界成长、人物成长或人物记忆标题。 */
  title: '世界成长' | '人物成长' | '人物记忆'
  /** 模型替身针对当前提炼类型返回的原始草稿。 */
  expectedDraft: string
  /** 浏览器中人工调整后准备发布的完整提示词。 */
  calibratedPrompt: string
  /** 保存发布成功后的页面反馈。 */
  publishedMessage: string
}

/**
 * 执行一次 AI 全量生成、人工校准和保存发布的完整浏览器流程。
 * @param page 当前浏览器页面，页面中只能有一个可见的学习提示词工作台。
 * @param options 当前提示词类型的确定草稿、校准文本及成功反馈。
 * @returns 已发布文本保留在统一编辑框中时结束。
 */
async function extractAndPublishLearningPrompt(page: Page, options: LearningPromptFlowOptions): Promise<void> {
  await expect(page.getByRole('heading', { name: `${options.title}提示词`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '全量生成', exact: true }).click()

  // Worker 异步消费提炼任务；反复使用页面提供的刷新动作，直到完整草稿已经落库。
  const completedAlert = page.getByText('完整提示词草稿已生成', { exact: true })
  for (let attempt = 0; attempt < 20 && !await completedAlert.isVisible(); attempt += 1) {
    await page.getByRole('button', { name: '刷新状态', exact: true }).click()
    await page.waitForTimeout(250)
  }
  await expect(completedAlert).toBeVisible()

  const editor = page.locator('[data-learning-prompt-editor]')
  await expect(editor).toHaveCount(1)
  await expect(editor).toHaveValue(options.expectedDraft)
  await editor.fill(options.calibratedPrompt)
  await page.getByRole('button', { name: '保存并发布', exact: true }).click()
  await expect(page.getByText(options.publishedMessage, { exact: true })).toBeVisible()
  await expect(editor).toHaveValue(options.calibratedPrompt)
}

test('首次设置、灵魂保存及文章直接生成形成可复现闭环', async ({ page }) => {
  // 单场景覆盖首次设置、三类学习提炼和异步生成，使用 Playwright 慢测试预算避免正常构建链被误判超时。
  test.slow()
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await waitForHydration(page)

  await page.getByLabel('管理员名称').fill(ADMINISTRATOR.username)
  await page.getByLabel('管理员密码', { exact: true }).fill(ADMINISTRATOR.password)
  await page.getByLabel('确认密码').fill(ADMINISTRATOR.password)
  await page.getByRole('button', { name: '完成设置并进入工作台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '先处理会影响后续创作的事', exact: true })).toBeVisible()
  await configureTestAi(page)

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
  await page.getByRole('button', { name: '人物空间', exact: true }).click()
  await page.getByRole('link', { name: '资料库', exact: true }).click()
  await page.getByRole('button', { name: '导入资料', exact: true }).click()
  const pasteForm = page.locator('form').filter({ has: page.getByRole('button', { name: '导入文本', exact: true }) })
  await pasteForm.getByLabel('资料名称').fill('浮岛背景资料')
  await pasteForm.getByLabel('正文').fill('浮岛城市依靠风帆船往来。')
  await pasteForm.getByRole('button', { name: '导入文本', exact: true }).click()
  await expect(page.getByText('浮岛背景资料', { exact: true })).toBeVisible()

  // 多文件按单项处理：合法文件保留，非法文件失败但不回滚成功项。
  await page.getByRole('button', { name: '导入资料', exact: true }).click()
  const fileForm = page.locator('form').filter({ has: page.locator('input[type="file"]') })
  await fileForm.locator('input[type="file"]').setInputFiles([
    { name: '港口规则.md', mimeType: 'text/markdown', buffer: Buffer.from('# 港口\n\n北港只允许风帆船靠岸。') },
    { name: '错误格式.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('不能导入') },
  ])
  await fileForm.getByRole('button', { name: '导入 2 个文件', exact: true }).click()
  await expect(page.getByText(
    '成功 1 个，失败 1 个。错误格式.exe：仅支持 UTF-8 编码的 TXT 或 Markdown 文件',
    { exact: true },
  )).toBeVisible()
  await expect(page.getByText('港口规则', { exact: true })).toBeVisible()

  // 资料项目使用名称筛选；正文段落搜索进入独立结果页并高亮关键词。
  await page.getByLabel('资料列表搜索词').fill('港口规则')
  await page.getByRole('button', { name: '筛选资料', exact: true }).click()
  await expect(page.getByText('港口规则', { exact: true })).toBeVisible()
  await expect(page.locator('a[data-source-title-link]')).toHaveCount(1)
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(page.locator('a[data-source-title-link]')).toHaveCount(2)
  await page.getByRole('link', { name: '全文检索', exact: true }).click()
  await expect(page.getByRole('heading', { name: '资料段落搜索', exact: true })).toBeVisible()
  await page.getByLabel('段落搜索词').fill('浮岛城市')
  await page.getByRole('button', { name: '搜索段落', exact: true }).click()
  await expect(page.getByText('北港航行规则', { exact: true })).toHaveCount(0)
  await expect(page.getByText('浮岛背景资料', { exact: true })).toBeVisible()
  await expect(page.locator('mark').filter({ hasText: '浮岛城市' })).toBeVisible()
  await page.getByRole('link', { name: '返回资料库', exact: true }).click()

  await page.getByRole('link', { name: '世界', exact: true }).click()
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await page.getByLabel('世界名称').fill('浮岛纪元')
  await page.getByLabel('世界灵魂提示词').fill('所有城市位于浮岛，远行依赖风帆船。')
  await page.getByRole('button', { name: '直接创建世界', exact: true }).click()
  await expect(page.getByRole('heading', { name: '浮岛纪元', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '资料', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '导入资料', exact: true }).click()
  await page.getByLabel('选择已有资料').fill('浮岛背景')
  await page.getByRole('option', { name: '浮岛背景资料', exact: true }).click()
  await page.getByRole('button', { name: '加入所选资料', exact: true }).click()
  await expect(page.getByText('1 项资料已加入这个世界', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.getByRole('button', { name: '灵魂', exact: true }).click()
  await expect(page.getByLabel('世界灵魂提示词')).toHaveValue('所有城市位于浮岛，远行依赖风帆船。')
  await page.getByLabel('世界灵魂提示词').fill('所有城市位于浮岛，远行依赖风帆船；北港限制靠岸类型。')
  await page.getByRole('button', { name: '保存并发布', exact: true }).click()
  await expect(page.getByText('世界灵魂已保存，之后创建的新任务将使用这一版', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看提示词历史', exact: true }).click()
  await expect(page.getByRole('heading', { name: '提示词历史', exact: true })).toBeVisible()
  await expect(page.getByText('所有城市位于浮岛，远行依赖风帆船。', { exact: true })).toBeVisible()

  // 世界成长从已关联资料复制固定快照，逐条评分后才交给 AI 综合提炼。
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await page.getByRole('button', { name: '成长素材', exact: true }).click()
  await expect(page.getByRole('heading', { name: '世界成长素材池', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '从资料库选择', exact: true }).click()
  await expect(page.getByRole('heading', { name: '从世界资料库选择成长素材', exact: true })).toBeVisible()
  const worldSourceRow = page.locator('[data-growth-import-source]').filter({ hasText: '浮岛背景资料' })
  await worldSourceRow.getByLabel('选择资料 浮岛背景资料').check()
  await worldSourceRow.locator('input[type="number"]').fill('5')
  await page.getByRole('button', { name: '导入 1 项资料', exact: true }).click()
  await expect(page.getByText('已从资料库导入 1 项世界成长素材', { exact: true })).toBeVisible()
  await expect(page.getByText('评分 5', { exact: true })).toBeVisible()
  await expect(page.getByLabel('每页素材数量')).toBeVisible()

  // 手工添加同样使用弹窗，但说明会明确它不会进入普通资料库。
  await page.getByRole('button', { name: '手工添加文档', exact: true }).click()
  await expect(page.getByRole('heading', { name: '添加世界成长素材', exact: true })).toBeVisible()
  await expect(page.getByText(/不会加入普通资料库/)).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  // 当前页勾选后显示批量入口，并能实际禁用、重新启用素材。
  await page.getByLabel('选择成长素材：浮岛背景资料').check()
  await page.getByRole('button', { name: '批量禁用', exact: true }).click()
  await expect(page.getByText('所选成长素材已不参加提炼', { exact: true })).toBeVisible()
  await expect(page.getByText('不参加提炼', { exact: true })).toBeVisible()
  await page.getByLabel('选择成长素材：浮岛背景资料').check()
  await page.getByRole('button', { name: '批量启用', exact: true }).click()
  await expect(page.getByText('所选成长素材已参加提炼', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.getByRole('button', { name: '成长', exact: true }).click()
  await expect(page.getByRole('heading', { name: '世界成长素材池', exact: true })).toHaveCount(0)
  await extractAndPublishLearningPrompt(page, {
    title: '世界成长',
    expectedDraft: '维护浮岛交通与港口规则的一致性，遇到资料冲突时明确适用条件。',
    calibratedPrompt: '维护浮岛交通与港口规则的一致性；遇到资料冲突时明确适用条件，并优先采用最新人工确认。',
    publishedMessage: '世界成长提示词已发布，之后创建的新任务将固定使用这一版',
  })

  // 窄屏下关键区块应纵向排列，页面不能产生横向溢出。
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '世界成长提示词', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })

  await page.getByRole('link', { name: '人物', exact: true }).click()
  await page.getByRole('button', { name: '创建人物', exact: true }).click()
  await page.getByLabel('人物名称').fill('林默')
  await page.getByLabel('人物灵魂提示词').fill('严谨克制的学院观察员，关注课程、档案与古代文献，表达冷静简洁。')
  await page.getByRole('button', { name: '直接创建人物', exact: true }).click()
  await expect(page.getByRole('heading', { name: '林默', exact: true })).toBeVisible()
  const personaWorkspaceUrl = page.url()
  const personaId = new URL(personaWorkspaceUrl).pathname.split('/').at(-1)
  if (!personaId) throw new Error('浏览器测试未能从人物工作台地址读取人物 UUID')

  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.getByRole('button', { name: '灵魂', exact: true }).click()
  await expect(page.getByLabel('人物灵魂提示词')).toHaveValue('严谨克制的学院观察员，关注课程、档案与古代文献，表达冷静简洁。')

  // 第三方记录拥有独立标签，并在弹窗中完成新增、修改、启停和删除。
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await page.getByRole('button', { name: '三方记录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第三方记录素材池', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加记录', exact: true }).click()
  await page.getByLabel('发生日期').click()
  await page.getByRole('dialog', { name: '发生日期', exact: true })
    .getByRole('button', { name: 'Previous month', exact: true })
    .click()
  await page.locator('[data-reka-calendar-cell-trigger][data-value="2026-08-30"]').click()
  await page.getByLabel('做了什么事情').fill('完成了一次第三方资料校对。')
  await page.getByLabel('记忆提炼评分').fill('4')
  await page.getByRole('button', { name: '添加记录', exact: true }).last().click()
  await expect(page.getByText('第三方记录已加入人物记忆素材池', { exact: true })).toBeVisible()
  await expect(page.getByLabel('每页第三方记录数量')).toBeVisible()
  await page.getByRole('button', { name: '修改', exact: true }).click()
  await page.getByLabel('做了什么事情').fill('完成了一次第三方资料校对并记录结论。')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByText('第三方记录已修改', { exact: true })).toBeVisible()
  await page.getByLabel('选择第三方记录：2026-08-30').check()
  await page.getByRole('button', { name: '批量禁用', exact: true }).click()
  await expect(page.getByText('所选第三方记录已不参加记忆提炼', { exact: true })).toBeVisible()
  await page.getByLabel('选择第三方记录：2026-08-30').check()
  await page.getByRole('button', { name: '批量启用', exact: true }).click()
  await expect(page.getByText('所选第三方记录已参加记忆提炼', { exact: true })).toBeVisible()
  await page.getByLabel('选择第三方记录：2026-08-30').check()
  await page.getByRole('button', { name: '批量删除', exact: true }).click()
  await page.getByRole('button', { name: '确认永久删除', exact: true }).click()
  await expect(page.getByText('所选第三方记录已删除', { exact: true })).toBeVisible()

  // 人物成长素材在资料分类中单独分页管理，成长提示词只负责提炼和校准。
  await page.getByRole('button', { name: '成长素材', exact: true }).click()
  await expect(page.getByRole('heading', { name: '人物成长素材池', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '手工添加文档', exact: true }).click()
  await page.getByLabel('素材标题').fill('表达与判断经验')
  await page.getByLabel('文档正文').fill('先给结论，再说明可核验依据；不确定时明确边界。')
  await page.getByLabel('提炼评分').fill('5')
  await page.getByRole('button', { name: '添加素材', exact: true }).click()
  await expect(page.getByText('手工文档已加入人物成长素材池', { exact: true })).toBeVisible()
  await expect(page.getByText('表达与判断经验', { exact: true })).toBeVisible()
  await expect(page.getByLabel('每页素材数量')).toBeVisible()

  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.getByRole('button', { name: '成长', exact: true }).click()
  await expect(page.getByRole('heading', { name: '人物成长提示词', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '人物成长素材池', exact: true })).toHaveCount(0)
  await extractAndPublishLearningPrompt(page, {
    title: '人物成长',
    expectedDraft: '表达时先给出结论，再用可核验的依据说明判断，并保持克制。',
    calibratedPrompt: '表达时先给结论，再用可核验依据说明判断；不确定时明确边界，并保持克制。',
    publishedMessage: '提示词已发布，之后创建的新任务将固定使用这一版',
  })

  // 历史版本只载入编辑框，用户再次保存发布后才成为新版本。
  await page.getByRole('button', { name: '查看提示词历史', exact: true }).click()
  await page.locator('[data-learning-history-version]').first().click()
  await page.locator('[data-learning-prompt-editor]').fill('表达时先给结论，并按证据强弱组织说明；不确定时明确边界。')
  await page.getByRole('button', { name: '保存并发布', exact: true }).click()
  await expect(page.getByText('提示词已发布，之后创建的新任务将固定使用这一版', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看提示词历史', exact: true }).click()
  await expect(page.locator('[data-learning-history-version]')).toHaveCount(2)
  await page.keyboard.press('Escape')

  await page.getByRole('main').getByRole('link', { name: '新建任务', exact: true }).click()
  await page.getByLabel('使用的人物').selectOption({ label: '林默' })
  await page.getByLabel('输出格式').selectOption('html')
  await page.getByLabel('生成条件').fill('用人物风格介绍学院课程，并输出 HTML。')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()

  await expect(page.getByRole('heading', { name: '生成结果', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTitle('HTML 图文混排结果')).toBeVisible()
  await expect(page.getByTitle('HTML 图文混排结果').contentFrame()
    .getByRole('heading', { name: '学院观察', exact: true, level: 1 })).toBeVisible()

  await downloadArtifact(page, '下载结果', 'html')

  // 成功任务自动形成记忆原始素材，可人工评分、批量启停，再提炼成独立记忆提示词。
  await page.goto(personaWorkspaceUrl)
  await waitForHydration(page)
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await page.getByRole('button', { name: '历史任务', exact: true }).click()
  await expect(page.getByRole('heading', { name: '历史任务素材池', exact: true })).toBeVisible()
  await expect(page.getByLabel('每页历史任务数量')).toBeVisible()
  await expect(page.getByText('图文任务已全部完成，已保留 1 段正文和 0 张图片。', { exact: true })).toBeVisible()
  await page.getByLabel('修改图文创作任务的提炼评分').fill('5')
  await page.getByLabel('修改图文创作任务的提炼评分').press('Tab')
  await expect(page.getByText('历史任务提炼评分已更新', { exact: true })).toBeVisible()
  await page.getByLabel('选择历史任务素材：图文创作任务').check()
  await page.getByRole('button', { name: '批量禁用', exact: true }).click()
  await expect(page.getByText('所选历史任务已不参加记忆提炼', { exact: true })).toBeVisible()
  await page.getByLabel('选择历史任务素材：图文创作任务').check()
  await page.getByRole('button', { name: '批量启用', exact: true }).click()
  await expect(page.getByText('所选历史任务已参加记忆提炼', { exact: true })).toBeVisible()

  // 记忆标签只保留提炼与提示词操作，不再混入两类记录列表。
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.getByRole('button', { name: '记忆', exact: true }).click()
  await expect(page.getByRole('heading', { name: '人物记忆提示词', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '历史任务素材池', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '第三方记录素材池', exact: true })).toHaveCount(0)

  await extractAndPublishLearningPrompt(page, {
    title: '人物记忆',
    expectedDraft: '记住曾完成学院课程介绍；后续同类任务优先采用严谨、克制且便于导出的结构。',
    calibratedPrompt: '记住曾完成学院课程介绍；后续同类任务先规划严谨、克制且便于多格式导出的结构。',
    publishedMessage: '提示词已发布，之后创建的新任务将固定使用这一版',
  })

  await verifyPublicGenerationApi(page, personaId)

  await page.getByRole('button', { name: '系统', exact: true }).click()
  await page.getByRole('link', { name: '系统中心', exact: true }).click()
  await expect(page.getByRole('heading', { name: '账户安全', exact: true })).toBeVisible()
  await expect(page.getByText('当前管理员', { exact: true }).locator('..')).toContainText(ADMINISTRATOR.username)
  await expect(page.getByText('系统默认运行限制', { exact: true })).toBeVisible()
  await expect(page.getByText('最多 12 个文字块', { exact: true })).toBeVisible()

  const changedPassword = 'e2e-password-updated-67890'
  const passwordForm = page.locator('form[data-change-password-form]')
  await passwordForm.locator('input[autocomplete="current-password"]').fill(ADMINISTRATOR.password)
  const newPasswordInputs = passwordForm.locator('input[autocomplete="new-password"]')
  await newPasswordInputs.nth(0).fill(changedPassword)
  await newPasswordInputs.nth(1).fill(changedPassword)
  await passwordForm.getByRole('button', { name: '修改密码', exact: true }).click()
  await expect(page.getByText('管理员密码已修改', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.getByLabel('管理员名称').fill(ADMINISTRATOR.username)
  await page.getByLabel('管理员密码', { exact: true }).fill(changedPassword)
  await page.getByRole('button', { name: '登录并进入工作台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '先处理会影响后续创作的事', exact: true })).toBeVisible()

  // 浏览器测试共用同一隔离数据库；验证新密码登录后恢复原密码，避免影响后续独立用例。
  const restorePasswordStatus = await page.evaluate(async input => (await fetch('/api/v1/auth/password', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })).status, {
    currentPassword: changedPassword,
    newPassword: ADMINISTRATOR.password,
    newPasswordConfirmation: ADMINISTRATOR.password,
  })
  expect(restorePasswordStatus).toBe(200)
})
