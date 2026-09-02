import { createError, getQuery, readBody } from 'h3'
import { useToast } from '#imports'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { AnalyzeSoulPromptInput, UpdatePersonasStatusInput, UpdateWorldsStatusInput } from '#shared/schemas/content'
import type { CreatePersonaDistillationInput } from '#shared/schemas/personaDistillation'
import type { PersonaSummary, WorldSummary } from '#shared/types/content'
import PersonasPage from '../../app/pages/personas/index.vue'
import WorldsPage from '../../app/pages/worlds/index.vue'

const worldSnapshot = {
  promptText: '人类生活在依靠浮石能量稳定的浮岛。',
}
const personaCreateRequests: unknown[] = []
const personaDistillationRequests: CreatePersonaDistillationInput[] = []
const worldCreateRequests: unknown[] = []
const soulAnalyzeRequests: AnalyzeSoulPromptInput[] = []
const personaStatusRequests: UpdatePersonasStatusInput[] = []
const worldStatusRequests: UpdateWorldsStatusInput[] = []
const personaPageQueries: Array<Record<string, string | string[] | undefined>> = []
const worldPageQueries: Array<Record<string, string | string[] | undefined>> = []

/** @returns 启用与禁用状态各一项的人物列表。 */
function createPersonaItems(): PersonaSummary[] {
  return [
    {
      id: '10000000-0000-4000-8000-000000000001', worldId: null, worldName: null, name: '启用人物', origin: 'original',
      activeVersionId: '11000000-0000-4000-8000-000000000001', currentSummary: '可参与新任务。', isEnabled: true,
      versionCount: 1, sourceCount: 0, createdAt: 1_000, updatedAt: 1_000,
    },
    {
      id: '10000000-0000-4000-8000-000000000002', worldId: null, worldName: null, name: '禁用人物', origin: 'original',
      activeVersionId: '11000000-0000-4000-8000-000000000002', currentSummary: '保留历史数据。', isEnabled: false,
      versionCount: 1, sourceCount: 0, createdAt: 2_000, updatedAt: 2_000,
    },
  ]
}

/** @returns 启用与禁用状态各一项的世界列表。 */
function createWorldItems(): WorldSummary[] {
  return [
    {
      id: '20000000-0000-4000-8000-000000000001', name: '启用世界', summary: '可进入新任务。',
      activeVersionId: '21000000-0000-4000-8000-000000000001', currentContent: '启用规则。', isEnabled: true,
      versionCount: 1, personaCount: 1, sourceCount: 1, createdAt: 1_000, updatedAt: 1_000,
    },
    {
      id: '20000000-0000-4000-8000-000000000002', name: '禁用世界', summary: '只保留历史。',
      activeVersionId: '21000000-0000-4000-8000-000000000002', currentContent: '禁用规则。', isEnabled: false,
      versionCount: 1, personaCount: 1, sourceCount: 1, createdAt: 2_000, updatedAt: 2_000,
    },
  ]
}

let personaItems = createPersonaItems()
let worldItems = createWorldItems()
let personaDistillationShouldFail = false

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/personas', {
  method: 'GET',
  handler: () => ({ data: [] }),
})
registerEndpoint('/api/v1/persona-distillations', {
  method: 'POST',
  handler: async (event) => {
    const input = await readBody<CreatePersonaDistillationInput>(event)
    personaDistillationRequests.push(input)
    if (personaDistillationShouldFail) throw createError({ statusCode: 503, message: '测试蒸馏创建失败' })
    return { data: { id: '30000000-0000-4000-8000-000000000001', requestedName: input.requestedName } }
  },
})
registerEndpoint('/api/v1/personas/page', (event) => {
  const query = getQuery(event)
  personaPageQueries.push(query)
  const keyword = typeof query.query === 'string' ? query.query : ''
  const items = personaItems.filter(persona => persona.name.includes(keyword))
  return { data: { items, total: items.length, page: 1, pageSize: 10, totalPages: 1 } }
})
registerEndpoint('/api/v1/personas', {
  method: 'POST',
  handler: async (event) => {
    personaCreateRequests.push(await readBody(event))
    throw createError({ statusCode: 503, message: '测试创建失败' })
  },
})
registerEndpoint('/api/v1/worlds', {
  method: 'GET',
  handler: () => ({ data: [] }),
})
registerEndpoint('/api/v1/worlds/page', (event) => {
  const query = getQuery(event)
  worldPageQueries.push(query)
  const keyword = typeof query.query === 'string' ? query.query : ''
  const items = worldItems.filter(world => world.name.includes(keyword))
  return { data: { items, total: items.length, page: 1, pageSize: 10, totalPages: 1 } }
})
registerEndpoint('/api/v1/worlds', {
  method: 'POST',
  handler: async (event) => {
    worldCreateRequests.push(await readBody(event))
    throw createError({ statusCode: 503, message: '测试创建失败' })
  },
})
registerEndpoint('/api/v1/soul/analyze', {
  method: 'POST',
  handler: async (event) => {
    const input = await readBody<AnalyzeSoulPromptInput>(event)
    soulAnalyzeRequests.push(input)
    if (input.promptText === '触发整理失败。') {
      throw createError({ statusCode: 503, message: '测试整理失败' })
    }
    return { data: input.subjectType === 'persona' ? personaSnapshot : worldSnapshot }
  },
})
registerEndpoint('/api/v1/personas/status', {
  method: 'PATCH',
  handler: async (event) => {
    const input = await readBody<UpdatePersonasStatusInput>(event)
    personaStatusRequests.push(input)
    personaItems = personaItems.map(persona => input.personaIds.includes(persona.id)
      ? { ...persona, isEnabled: input.isEnabled }
      : persona)
    return { data: input }
  },
})
registerEndpoint('/api/v1/worlds/status', {
  method: 'PATCH',
  handler: async (event) => {
    const input = await readBody<UpdateWorldsStatusInput>(event)
    worldStatusRequests.push(input)
    worldItems = worldItems.map(world => input.worldIds.includes(world.id)
      ? { ...world, isEnabled: input.isEnabled }
      : world)
    return { data: input }
  },
})

/**
 * 按用户操作打开快速创建弹窗、输入名称和提示词并提交。
 * @param wrapper 当前人物或世界列表页包装器。
 * @param openLabel 列表页创建按钮的可见文字。
 * @param submitLabel 弹窗确认按钮的可见文字。
 * @param name 填入名称输入框的对象名称。
 * @param promptText 填入编辑框的灵魂提示词。
 * @param autoAnalyze 是否选择 AI 整理。
 * @returns 弹窗中的名称与提示词输入元素，用于验证失败后内容保留。
 */
async function submitQuickCreate(
  wrapper: VueWrapper,
  openLabel: string,
  submitLabel: string,
  name: string,
  promptText: string,
  autoAnalyze: boolean,
): Promise<{ nameInput: HTMLInputElement, promptTextarea: HTMLTextAreaElement }> {
  await wrapper.findAll('button').find(button => button.text() === openLabel)!.trigger('click')
  await flushPromises()
  const nameInput = document.querySelector<HTMLInputElement>('[data-quick-create-form] input[type="text"]')
  const promptTextarea = document.querySelector<HTMLTextAreaElement>('[data-quick-create-form] textarea')
  expect(nameInput).toBeDefined()
  expect(promptTextarea).toBeDefined()
  await new DOMWrapper(nameInput!).setValue(name)
  await new DOMWrapper(promptTextarea!).setValue(promptText)
  if (autoAnalyze) {
    const analyzeCheckbox = document.querySelector<HTMLElement>('[data-quick-create-auto-analyze]')
    expect(analyzeCheckbox).toBeDefined()
    await new DOMWrapper(analyzeCheckbox!).trigger('click')
  }
  const submitButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes(submitLabel))
  expect(submitButton).toBeDefined()
  await new DOMWrapper(submitButton!).trigger('click')
  await flushPromises()
  await flushPromises()
  return { nameInput: nameInput!, promptTextarea: promptTextarea! }
}

/**
 * 按用户操作打开人物蒸馏弹窗、输入名称和用途并提交。
 * @param wrapper 当前人物列表页包装器。
 * @param name 候选人物名称。
 * @param objective 人物用途与聚焦方向。
 * @returns 弹窗中的名称与用途输入元素，用于验证失败后内容保留。
 */
async function submitPersonaDistillation(
  wrapper: VueWrapper,
  name: string,
  objective: string,
): Promise<{ nameInput: HTMLInputElement, objectiveTextarea: HTMLTextAreaElement }> {
  const openButton = wrapper.findAll('button').find(button => button.text() === '创建人物')
  if (!openButton) throw new Error('人物列表缺少创建人物按钮')
  await openButton.trigger('click')
  await flushPromises()
  const nameInput = document.querySelector<HTMLInputElement>('[data-persona-distillation-create] input[type="text"]')
  const objectiveTextarea = document.querySelector<HTMLTextAreaElement>('[data-persona-distillation-create] textarea')
  expect(nameInput).toBeDefined()
  expect(objectiveTextarea).toBeDefined()
  if (!nameInput || !objectiveTextarea) throw new Error('人物蒸馏创建表单缺少名称或用途输入')
  await new DOMWrapper(nameInput).setValue(name)
  await new DOMWrapper(objectiveTextarea).setValue(objective)
  const submitButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes('开始人物蒸馏'))
  expect(submitButton).toBeDefined()
  if (!submitButton) throw new Error('人物蒸馏创建表单缺少提交按钮')
  await new DOMWrapper(submitButton).trigger('click')
  await flushPromises()
  await flushPromises()
  return { nameInput, objectiveTextarea }
}

describe('世界与人物列表快速初始化', () => {
  beforeEach(() => {
    personaCreateRequests.length = 0
    personaDistillationRequests.length = 0
    worldCreateRequests.length = 0
    soulAnalyzeRequests.length = 0
    personaStatusRequests.length = 0
    worldStatusRequests.length = 0
    personaPageQueries.length = 0
    worldPageQueries.length = 0
    personaItems = createPersonaItems()
    worldItems = createWorldItems()
    personaDistillationShouldFail = false
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('人物列表只创建异步蒸馏运行，世界列表仍可按原文直接创建', async () => {
    const wrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    wrapper.vm.$nuxt.runWithContext(() => useToast().clear())
    await submitPersonaDistillation(wrapper, '林默', '提炼谨慎且重视证据的判断方式。')

    expect(soulAnalyzeRequests).toEqual([])
    expect(personaCreateRequests).toEqual([])
    expect(personaDistillationRequests).toEqual([{
      requestedName: '林默',
      objective: '提炼谨慎且重视证据的判断方式。',
      worldId: null,
      sourceIds: [],
    }])
    wrapper.unmount()
    document.body.innerHTML = ''

    const worldWrapper = await mountSuspended(WorldsPage, { route: '/worlds' })
    worldWrapper.vm.$nuxt.runWithContext(() => useToast().clear())
    const worldPrompt = '浮岛依靠浮石能量维持稳定。'
    const worldInputs = await submitQuickCreate(worldWrapper, '创建世界', '直接创建世界', '浮岛纪元', worldPrompt, false)

    expect(soulAnalyzeRequests).toEqual([])
    expect(worldCreateRequests).toEqual([{
      name: '浮岛纪元', summary: '', snapshot: { promptText: worldPrompt },
      changeSummary: '按原文建立初始世界灵魂',
    }])
    expect(worldInputs.nameInput.value).toBe('浮岛纪元')
    expect(worldInputs.promptTextarea.value).toBe(worldPrompt)
    await vi.waitFor(() => expect(worldWrapper.vm.$nuxt.runWithContext(() => useToast().toasts.value)
      .some(notification => notification.title === '世界创建失败')).toBe(true))
  })

  it('世界列表选择 AI 时先整理提示词再创建且保留用户名称', async () => {
    const worldWrapper = await mountSuspended(WorldsPage, { route: '/worlds' })
    await submitQuickCreate(worldWrapper, '创建世界', 'AI 整理并创建世界', '用户指定世界名', '原始世界提示词。', true)

    expect(soulAnalyzeRequests).toEqual([{ subjectType: 'world', promptText: '原始世界提示词。' }])
    expect(worldCreateRequests).toEqual([{
      name: '用户指定世界名', summary: '', snapshot: worldSnapshot,
      changeSummary: 'AI 整理初始世界灵魂',
    }])
  })

  it('人物蒸馏运行创建失败时不创建人物并保留输入', async () => {
    personaDistillationShouldFail = true
    const wrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    wrapper.vm.$nuxt.runWithContext(() => useToast().clear())
    const inputs = await submitPersonaDistillation(wrapper, '失败保护人物', '触发蒸馏运行创建失败。')

    expect(personaDistillationRequests).toEqual([{
      requestedName: '失败保护人物',
      objective: '触发蒸馏运行创建失败。',
      worldId: null,
      sourceIds: [],
    }])
    expect(personaCreateRequests).toEqual([])
    expect(inputs.nameInput.value).toBe('失败保护人物')
    expect(inputs.objectiveTextarea.value).toBe('触发蒸馏运行创建失败。')
    await vi.waitFor(() => expect(wrapper.vm.$nuxt.runWithContext(() => useToast().toasts.value)
      .some(notification => notification.title === '人物蒸馏创建失败')).toBe(true))
  })

  it('人物与世界列表移除设定状态且默认每页十项并保留启停确认', async () => {
    const personaWrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    await flushPromises()

    expect(personaWrapper.text()).not.toContain('已选择')
    expect(personaWrapper.text()).not.toContain('设定状态')
    expect(personaWrapper.text()).not.toContain('待确认设定')
    const personaPageSize = personaWrapper.findAllComponents({ name: 'USelect' })[0]!
    expect(personaPageSize.props('modelValue')).toBe(10)
    expect(personaPageSize.props('items').map((item: { value: number }) => item.value)).toEqual([5, 10, 20, 50, 100])
    expect(personaWrapper.get('a[data-persona-avatar-link]').attributes('href')).toBe('/personas/10000000-0000-4000-8000-000000000001')
    expect(personaWrapper.get('a[data-persona-title-link]').attributes('href')).toBe('/personas/10000000-0000-4000-8000-000000000001')
    expect(personaWrapper.get('a[aria-label="查看与维护：启用人物"]').exists()).toBe(true)
    const personaDetailsButton = personaWrapper.findAllComponents({ name: 'UButton' })
      .find(button => button.props('icon') === 'i-lucide-chevron-right')!
    expect(personaDetailsButton.props()).toMatchObject({ size: 'xs', variant: 'ghost' })

    await personaWrapper.get('input[aria-label="选择人物：启用人物"]').setValue(true)
    expect(personaWrapper.text()).toContain('已选择 1 个人物')
    await personaWrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量禁用')!.trigger('click')
    await flushPromises()
    expect(personaStatusRequests).toHaveLength(0)
    const confirmPersona = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认禁用')
    expect(confirmPersona).toBeDefined()
    await new DOMWrapper(confirmPersona!).trigger('click')
    await flushPromises()
    expect(personaStatusRequests[0]).toEqual({
      personaIds: ['10000000-0000-4000-8000-000000000001'], isEnabled: false,
    })
    await vi.waitFor(() => expect(personaWrapper.text()).not.toContain('已选择'))
    await personaWrapper.get('input[aria-label="选择人物：禁用人物"]').setValue(true)
    await personaWrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量启用')!.trigger('click')
    await flushPromises()
    expect(personaStatusRequests).toHaveLength(1)
    const confirmEnablePersona = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认启用')
    expect(confirmEnablePersona).toBeDefined()
    await new DOMWrapper(confirmEnablePersona!).trigger('click')
    await flushPromises()
    expect(personaStatusRequests[1]).toEqual({
      personaIds: ['10000000-0000-4000-8000-000000000002'], isEnabled: true,
    })
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('确认批量启用人物'))
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('确认批量禁用人物'))
    personaWrapper.unmount()
    document.body.innerHTML = ''

    const worldWrapper = await mountSuspended(WorldsPage, { route: '/worlds' })
    await flushPromises()
    expect(worldWrapper.text()).not.toContain('设定状态')
    expect(worldWrapper.text()).not.toContain('本页待确认')
    expect(worldWrapper.text()).not.toContain('已选择')
    const worldPageSize = worldWrapper.findAllComponents({ name: 'USelect' })[0]!
    expect(worldPageSize.props('modelValue')).toBe(10)
    expect(worldPageSize.props('items').map((item: { value: number }) => item.value)).toEqual([5, 10, 20, 50, 100])
    expect(worldWrapper.get('a[data-world-title-link]').attributes('href')).toBe('/worlds/20000000-0000-4000-8000-000000000001')
    expect(worldWrapper.get('a[aria-label="查看与维护：启用世界"]').exists()).toBe(true)

    await worldWrapper.get('input[aria-label="选择世界：启用世界"]').setValue(true)
    await worldWrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量禁用')!.trigger('click')
    await flushPromises()
    expect(worldStatusRequests).toHaveLength(0)
    const confirmWorld = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认禁用')
    expect(confirmWorld).toBeDefined()
    await new DOMWrapper(confirmWorld!).trigger('click')
    await flushPromises()
    expect(worldStatusRequests[0]).toEqual({
      worldIds: ['20000000-0000-4000-8000-000000000001'], isEnabled: false,
    })
    await vi.waitFor(() => expect(worldWrapper.text()).not.toContain('已选择'))
    await worldWrapper.get('input[aria-label="选择世界：禁用世界"]').setValue(true)
    await worldWrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量启用')!.trigger('click')
    await flushPromises()
    expect(worldStatusRequests).toHaveLength(1)
    const confirmEnableWorld = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认启用')
    expect(confirmEnableWorld).toBeDefined()
    await new DOMWrapper(confirmEnableWorld!).trigger('click')
    await flushPromises()
    expect(worldStatusRequests[1]).toEqual({
      worldIds: ['20000000-0000-4000-8000-000000000002'], isEnabled: true,
    })
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('确认批量启用世界'))
    worldWrapper.unmount()
  })

  it('人物与世界列表按名称进行服务端筛选并支持清除筛选', async () => {
    const personaWrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    await flushPromises()
    const personaRequestCount = personaPageQueries.length
    await personaWrapper.get('input[aria-label="人物列表搜索词"]').setValue('禁用')
    await personaWrapper.get('form[aria-label="筛选人物"]').trigger('submit')
    await vi.waitFor(() => expect(personaPageQueries.length).toBeGreaterThan(personaRequestCount))
    expect(personaPageQueries.at(-1)).toMatchObject({ query: '禁用', page: '1' })
    await vi.waitFor(() => expect(personaWrapper.text()).toContain('禁用人物'))
    expect(personaWrapper.text()).not.toContain('启用人物')
    await personaWrapper.findAllComponents({ name: 'UButton' })
      .find(button => button.text() === '清除筛选')!.trigger('click')
    await vi.waitFor(() => expect(personaWrapper.text()).toContain('启用人物'))
    personaWrapper.unmount()
    document.body.innerHTML = ''

    const worldWrapper = await mountSuspended(WorldsPage, { route: '/worlds' })
    await flushPromises()
    const worldRequestCount = worldPageQueries.length
    await worldWrapper.get('input[aria-label="世界列表搜索词"]').setValue('禁用')
    await worldWrapper.get('form[aria-label="筛选世界"]').trigger('submit')
    await vi.waitFor(() => expect(worldPageQueries.length).toBeGreaterThan(worldRequestCount))
    expect(worldPageQueries.at(-1)).toMatchObject({ query: '禁用', page: '1' })
    await vi.waitFor(() => expect(worldWrapper.text()).toContain('禁用世界'))
    expect(worldWrapper.text()).not.toContain('启用世界')
    await worldWrapper.findAllComponents({ name: 'UButton' })
      .find(button => button.text() === '清除筛选')!.trigger('click')
    await vi.waitFor(() => expect(worldWrapper.text()).toContain('启用世界'))
    worldWrapper.unmount()
  })
})
