import { createError, readBody } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { UpdatePersonasStatusInput, UpdateWorldsStatusInput } from '#shared/schemas/content'
import type { PersonaSummary, WorldSummary } from '#shared/types/content'
import PersonasPage from '../../app/pages/personas/index.vue'
import WorldsPage from '../../app/pages/worlds/index.vue'

const personaSnapshot = {
  chapters: [{ id: '50000000-0000-4000-8000-000000000001', title: '核心人设', content: '谨慎的档案员。', order: 0, required: true }],
  runtimeSummary: '谨慎的档案员，重视证据。',
}
const worldSnapshot = {
  chapters: [{ id: '60000000-0000-4000-8000-000000000001', title: '核心规则', content: '浮岛依靠浮石能量稳定。', order: 0, required: true }],
  runtimeSummary: '人类生活在依靠浮石能量稳定的浮岛。',
}
const personaDraftRequests: unknown[] = []
const personaCreateRequests: unknown[] = []
const worldDraftRequests: unknown[] = []
const worldCreateRequests: unknown[] = []
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
registerEndpoint('/api/v1/personas/draft', {
  method: 'POST',
  handler: async (event) => {
    personaDraftRequests.push(await readBody(event))
    return { data: { name: '林默', snapshot: personaSnapshot, warnings: [] } }
  },
})
registerEndpoint('/api/v1/worlds/draft', {
  method: 'POST',
  handler: async (event) => {
    worldDraftRequests.push(await readBody(event))
    return { data: { name: '浮岛纪元', summary: '浮岛世界', snapshot: worldSnapshot } }
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
 * 按用户操作打开快速创建弹窗、输入描述并提交。
 * @param wrapper 当前人物或世界列表页包装器。
 * @param openLabel 列表页创建按钮的可见文字。
 * @param submitLabel 弹窗确认按钮的可见文字。
 * @param prompt 填入编辑框的自然语言描述。
 * @returns 弹窗中的原生文本框，用于验证失败后内容保留。
 */
async function submitQuickCreate(
  wrapper: VueWrapper,
  openLabel: string,
  submitLabel: string,
  prompt: string,
): Promise<HTMLTextAreaElement> {
  await wrapper.findAll('button').find(button => button.text() === openLabel)!.trigger('click')
  await flushPromises()
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
  expect(textarea).toBeDefined()
  await new DOMWrapper(textarea!).setValue(prompt)
  const submitButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes(submitLabel))
  expect(submitButton).toBeDefined()
  await new DOMWrapper(submitButton!).trigger('click')
  await flushPromises()
  await flushPromises()
  return textarea!
}

describe('世界与人物列表快速初始化', () => {
  beforeEach(() => {
    personaDraftRequests.length = 0
    personaCreateRequests.length = 0
    worldDraftRequests.length = 0
    worldCreateRequests.length = 0
    personaStatusRequests.length = 0
    worldStatusRequests.length = 0
    personaItems = createPersonaItems()
    worldItems = createWorldItems()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('人物按原创且无关联方式生成后创建，创建失败保留原文', async () => {
    const wrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    const prompt = '创建一名谨慎且重视证据的档案员'
    const textarea = await submitQuickCreate(wrapper, '创建人物', '生成并创建人物', prompt)

    expect(personaDraftRequests).toEqual([{ prompt, origin: 'original', worldId: null, sourceIds: [] }])
    expect(personaCreateRequests).toEqual([{
      name: '林默', origin: 'original', worldId: null, sourceIds: [], snapshot: personaSnapshot,
      changeSummary: '根据自然语言生成初始人物灵魂草稿',
    }])
    expect(textarea.value).toBe(prompt)
    expect(document.body.textContent).toContain('创建失败')
  })

  it('世界生成名称摘要和灵魂后创建，创建失败保留原文', async () => {
    const wrapper = await mountSuspended(WorldsPage, { route: '/worlds' })
    const prompt = '创建一个浮岛与风帆船构成的世界'
    const textarea = await submitQuickCreate(wrapper, '创建世界', '生成并创建世界', prompt)

    expect(worldDraftRequests).toEqual([{ prompt }])
    expect(worldCreateRequests).toEqual([{
      name: '浮岛纪元', summary: '浮岛世界', snapshot: worldSnapshot,
      changeSummary: '根据自然语言生成初始世界灵魂草稿',
    }])
    expect(textarea.value).toBe(prompt)
    expect(document.body.textContent).toContain('创建失败')
  })

  it('人物与世界列表默认每页十项且批量启用与禁用均需确认', async () => {
    const personaWrapper = await mountSuspended(PersonasPage, { route: '/personas' })
    await flushPromises()

    expect(personaWrapper.text()).not.toContain('已选择')
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
