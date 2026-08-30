import { createError, readBody } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { AnalyzeSoulPromptInput, UpdatePersonasStatusInput, UpdateWorldsStatusInput } from '#shared/schemas/content'
import type { PersonaSummary, WorldSummary } from '#shared/types/content'
import PersonasPage from '../../app/pages/personas/index.vue'
import WorldsPage from '../../app/pages/worlds/index.vue'

const personaSnapshot = {
  promptText: '谨慎的档案员，重视证据。',
}
const worldSnapshot = {
  promptText: '人类生活在依靠浮石能量稳定的浮岛。',
}
const personaCreateRequests: unknown[] = []
const worldCreateRequests: unknown[] = []
const soulAnalyzeRequests: AnalyzeSoulPromptInput[] = []
const personaStatusRequests: UpdatePersonasStatusInput[] = []
const worldStatusRequests: UpdateWorldsStatusInput[] = []

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

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/personas', {
  method: 'GET',
  handler: () => ({ data: [] }),
})
registerEndpoint('/api/v1/personas/page', () => ({
  data: { items: personaItems, total: personaItems.length, page: 1, pageSize: 10, totalPages: 1 },
}))
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
registerEndpoint('/api/v1/worlds/page', () => ({
  data: { items: worldItems, total: worldItems.length, page: 1, pageSize: 10, totalPages: 1 },
}))
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

describe('世界与人物列表快速初始化', () => {
  beforeEach(() => {
    personaCreateRequests.length = 0
    worldCreateRequests.length = 0
    soulAnalyzeRequests.length = 0
    personaStatusRequests.length = 0
    worldStatusRequests.length = 0
    personaItems = createPersonaItems()
    worldItems = createWorldItems()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('列表创建未选择 AI 时按原始提示词直接创建人物和世界', async () => {
    const wrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    const personaPrompt = '谨慎且重视证据的档案员。'
    const personaInputs = await submitQuickCreate(wrapper, '创建人物', '直接创建人物', '林默', personaPrompt, false)

    expect(soulAnalyzeRequests).toEqual([])
    expect(personaCreateRequests).toEqual([{
      name: '林默', origin: 'original', worldId: null, sourceIds: [], snapshot: { promptText: personaPrompt },
      changeSummary: '按原文建立初始人物灵魂',
    }])
    expect(personaInputs.nameInput.value).toBe('林默')
    expect(personaInputs.promptTextarea.value).toBe(personaPrompt)
    expect(document.body.textContent).toContain('创建失败')
    wrapper.unmount()
    document.body.innerHTML = ''

    const worldWrapper = await mountSuspended(WorldsPage, { route: '/worlds' })
    const worldPrompt = '浮岛依靠浮石能量维持稳定。'
    const worldInputs = await submitQuickCreate(worldWrapper, '创建世界', '直接创建世界', '浮岛纪元', worldPrompt, false)

    expect(soulAnalyzeRequests).toEqual([])
    expect(worldCreateRequests).toEqual([{
      name: '浮岛纪元', summary: '', snapshot: { promptText: worldPrompt },
      changeSummary: '按原文建立初始世界灵魂',
    }])
    expect(worldInputs.nameInput.value).toBe('浮岛纪元')
    expect(worldInputs.promptTextarea.value).toBe(worldPrompt)
    expect(document.body.textContent).toContain('创建失败')
  })

  it('列表创建选择 AI 时先整理提示词再创建且保留用户名称', async () => {
    const personaWrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    await submitQuickCreate(personaWrapper, '创建人物', 'AI 整理并创建人物', '用户指定人物名', '原始人物提示词。', true)

    expect(soulAnalyzeRequests).toEqual([{ subjectType: 'persona', promptText: '原始人物提示词。' }])
    expect(personaCreateRequests).toEqual([{
      name: '用户指定人物名', origin: 'original', worldId: null, sourceIds: [], snapshot: personaSnapshot,
      changeSummary: 'AI 整理初始人物灵魂',
    }])
    personaWrapper.unmount()
    document.body.innerHTML = ''

    const worldWrapper = await mountSuspended(WorldsPage, { route: '/worlds' })
    await submitQuickCreate(worldWrapper, '创建世界', 'AI 整理并创建世界', '用户指定世界名', '原始世界提示词。', true)

    expect(soulAnalyzeRequests).toEqual([
      { subjectType: 'persona', promptText: '原始人物提示词。' },
      { subjectType: 'world', promptText: '原始世界提示词。' },
    ])
    expect(worldCreateRequests).toEqual([{
      name: '用户指定世界名', summary: '', snapshot: worldSnapshot,
      changeSummary: 'AI 整理初始世界灵魂',
    }])
  })

  it('列表创建 AI 整理失败时不创建对象并保留输入', async () => {
    const wrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    const inputs = await submitQuickCreate(
      wrapper,
      '创建人物',
      'AI 整理并创建人物',
      '失败保护人物',
      '触发整理失败。',
      true,
    )

    expect(soulAnalyzeRequests).toEqual([{ subjectType: 'persona', promptText: '触发整理失败。' }])
    expect(personaCreateRequests).toEqual([])
    expect(inputs.nameInput.value).toBe('失败保护人物')
    expect(inputs.promptTextarea.value).toBe('触发整理失败。')
    expect(document.body.textContent).toContain('创建失败')
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
})
