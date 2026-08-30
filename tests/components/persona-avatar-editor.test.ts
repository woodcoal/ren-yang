import { beforeEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import PersonaAvatarEditor from '../../app/components/content/PersonaAvatarEditor.vue'

/** 测试人物 UUID。 */
const PERSONA_ID = '00000000-0000-4000-8000-000000000001'
/** 上传接口收到的请求数量。 */
let uploadRequests = 0
/** 生成接口收到的请求数量。 */
let generationRequests = 0

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
  handler: () => {
    generationRequests += 1
    return { data: { id: PERSONA_ID, avatarUrl: `/api/v1/personas/${PERSONA_ID}/avatar` } }
  },
})

beforeEach(() => {
  uploadRequests = 0
  generationRequests = 0
})

describe('人物头像编辑器', () => {
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
    expect(wrapper.emitted('updated')).toHaveLength(1)
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
