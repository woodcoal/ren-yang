import { createError, readBody } from 'h3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
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

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/personas', {
  method: 'GET',
  handler: () => ({ data: [] }),
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
})
