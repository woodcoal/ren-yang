import { readBody } from 'h3'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import AiLoadingOverlay from '../../app/components/AiLoadingOverlay.vue'
import PersonaAvatar from '../../app/components/content/PersonaAvatar.vue'
import PersonaAvatarEditor from '../../app/components/content/PersonaAvatarEditor.vue'
import type { GeneratePersonaAvatarInput } from '../../shared/schemas/content'

/** 测试人物 UUID。 */
const PERSONA_ID = '00000000-0000-4000-8000-000000000001'
/** 上传接口收到的请求数量。 */
let uploadRequests = 0
/** 生成接口收到的请求数量。 */
let generationRequests = 0
/** 生成接口收到的请求体。 */
const generationInputs: GeneratePersonaAvatarInput[] = []
/** 当前测试是否需要保持头像生成请求挂起。 */
let delayGenerationResponse = false
/** 结束当前挂起头像生成请求的回调。 */
let releaseGenerationResponse: (() => void) | null = null

/** 同时挂载头像编辑器与真实全局 AI 加载层，复现两个 Nuxt UI 模态层的交接。 */
const PersonaAvatarGenerationHarness = defineComponent({
  components: { AiLoadingOverlay, PersonaAvatarEditor },
  template: '<div><PersonaAvatarEditor persona-id="00000000-0000-4000-8000-000000000001" persona-name="林默" :avatar-url="null" /><AiLoadingOverlay /></div>',
})

registerEndpoint(`/api/v1/personas/${PERSONA_ID}/avatar`, {
  method: 'PUT',
  /** @returns 模拟更新后的头像人物摘要。 */
  handler: () => {
    uploadRequests += 1
    return { data: { id: PERSONA_ID, avatarUrl: `/api/v1/personas/${PERSONA_ID}/avatar` } }
  },
})

registerEndpoint(`/api/v1/personas/${PERSONA_ID}/avatar/generate`, {
  method: 'POST',
  /** @returns 模拟生成后的头像人物摘要。 */
  handler: async (event) => {
    generationRequests += 1
    generationInputs.push(await readBody<GeneratePersonaAvatarInput>(event))
    if (delayGenerationResponse) {
      await new Promise<void>((resolveRequest) => {
        releaseGenerationResponse = resolveRequest
      })
    }
    return { data: { id: PERSONA_ID, avatarUrl: `/api/v1/personas/${PERSONA_ID}/avatar` } }
  },
})

beforeEach(() => {
  releaseGenerationResponse?.()
  uploadRequests = 0
  generationRequests = 0
  generationInputs.length = 0
  delayGenerationResponse = false
  releaseGenerationResponse = null
})

describe('人物头像编辑器', () => {
  it('页首头像使用独立尺寸并保留无图占位', async () => {
    const wrapper = await mountSuspended(PersonaAvatar, {
      props: { name: '林默', url: null, size: 'header' },
    })

    expect(wrapper.text()).toBe('林')
    expect(wrapper.get('.persona-avatar-header').exists()).toBe(true)
  })

  it('无头像时显示姓名首字，并可上传受支持图片', async () => {
    const wrapper = await mountSuspended(PersonaAvatarEditor, {
      props: { personaId: PERSONA_ID, personaName: '林默', avatarUrl: null },
    })
    expect(wrapper.text()).toContain('林')
    expect(wrapper.find('img').exists()).toBe(false)

    const input = wrapper.get<HTMLInputElement>('[data-persona-avatar-input]')
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'avatar.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(uploadRequests).toBe(1)
    expect(wrapper.emitted('updated')).toHaveLength(1)
    expect(wrapper.text()).toContain('统一保存为 512×512')
  })

  it('点击生成头像后调用生成接口并公开更新事件', async () => {
    const wrapper = await mountSuspended(PersonaAvatarEditor, {
      props: { personaId: PERSONA_ID, personaName: '林默', avatarUrl: null },
    })
    const generateButton = wrapper.findAll<HTMLButtonElement>('button')
      .find(button => button.text().includes('生成头像'))
    expect(generateButton).toBeDefined()

    await new DOMWrapper(generateButton!.element).trigger('click')
    await flushPromises()

    expect(generationRequests).toBe(1)
    expect(generationInputs).toEqual([{ additionalPrompt: '' }])
    await vi.waitFor(() => expect(wrapper.emitted('updated')).toHaveLength(1))
  })

  it('自定义生成提交后关闭弹窗并显示全局 AI 加载层', async () => {
    delayGenerationResponse = true
    const wrapper = await mountSuspended(PersonaAvatarGenerationHarness)
    const customButton = wrapper.findAll<HTMLButtonElement>('button')
      .find(button => button.text().includes('自定义生成'))
    expect(customButton).toBeDefined()

    await new DOMWrapper(customButton!.element).trigger('click')
    await flushPromises()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="additionalPrompt"]')
    expect(textarea).not.toBeNull()
    await new DOMWrapper(textarea!).setValue('水彩插画，暖色逆光，旧档案馆背景。')
    const submitButton = document.querySelector<HTMLButtonElement>('[data-custom-avatar-form] button[type="submit"]')
    expect(submitButton).not.toBeNull()
    try {
      await new DOMWrapper(submitButton!).trigger('click')
      await vi.waitFor(() => {
        expect(generationInputs).toEqual([{ additionalPrompt: '水彩插画，暖色逆光，旧档案馆背景。' }])
        expect(document.querySelector('[data-ai-loading-overlay]')).not.toBeNull()
        expect(document.querySelector('[data-custom-avatar-form]')).toBeNull()
      })
    }
    finally {
      releaseGenerationResponse?.()
      await flushPromises()
    }
  })

  it('在客户端拒绝不支持的上传类型', async () => {
    const wrapper = await mountSuspended(PersonaAvatarEditor, {
      props: { personaId: PERSONA_ID, personaName: '林默', avatarUrl: null },
    })
    const input = wrapper.get<HTMLInputElement>('[data-persona-avatar-input]')
    const file = new File(['text'], 'avatar.gif', { type: 'image/gif' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')

    expect(uploadRequests).toBe(0)
    expect(wrapper.text()).toContain('仅支持 PNG、JPEG 或 WebP 图片')
  })
})
