import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import ApiKeyManager from '../../app/components/apiKey/ApiKeyManager.vue'
import type { ApiKeyView } from '../../shared/types/publicApi'

const ACTIVE_KEY: ApiKeyView = {
  id: '00000000-0000-4000-8000-000000000301',
  name: '资料同步',
  prefix: 'ry_v2_abcdef',
  scopes: ['library:read', 'library:write', 'generation:read', 'generation:write'],
  status: 'active',
  createdAt: Date.parse('2026-09-01T08:00:00.000Z'),
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
}

let keys: ApiKeyView[] = [ACTIVE_KEY]

beforeEach(() => {
  keys = [ACTIVE_KEY]
})

registerEndpoint('/api/v1/api-keys', {
  method: 'GET',
  handler: () => ({ data: keys }),
})
registerEndpoint('/api/v1/api-keys', {
  method: 'POST',
  handler: async () => ({
    data: {
      key: { ...ACTIVE_KEY, id: '00000000-0000-4000-8000-000000000302', name: '新脚本' },
      secret: 'ry_v2_once_only_secret',
    },
  }),
})
registerEndpoint('/api/v1/api-keys/00000000-0000-4000-8000-000000000301/revoke', {
  method: 'POST',
  handler: () => {
    const revoked: ApiKeyView = { ...ACTIVE_KEY, status: 'revoked', revokedAt: Date.parse('2026-09-01T09:00:00.000Z') }
    keys = [revoked]
    return { data: revoked }
  },
})

describe('API Key 管理界面', () => {
  it('展示用途、前缀、权限、使用状态且不展示摘要', async () => {
    keys = [ACTIVE_KEY]
    const wrapper = await mountSuspended(ApiKeyManager)

    expect(wrapper.text()).toContain('资料同步')
    expect(wrapper.text()).toContain('ry_v2_abcdef')
    expect(wrapper.text()).toContain('资料读取')
    expect(wrapper.text()).toContain('资料写入')
    expect(wrapper.text()).toContain('图文运行读取')
    expect(wrapper.text()).toContain('图文运行创建与操作')
    expect(wrapper.text()).toContain('尚未使用')
    expect(wrapper.text()).not.toContain('keyDigest')
  })

  it('创建后只在当前页面状态展示一次完整明文，关闭后无法恢复', async () => {
    const wrapper = await mountSuspended(ApiKeyManager)
    const form = wrapper.findComponent({ name: 'ApiKeyCreateForm' })

    form.vm.$emit('submit', { name: '新脚本', scopes: ['persona:read'], expiresAt: null })
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('ry_v2_once_only_secret')
    wrapper.findComponent({ name: 'ApiKeyCreatedSecret' }).vm.$emit('dismiss')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('ry_v2_once_only_secret')
  })

  it('明确确认后吊销 Key 并刷新状态', async () => {
    keys = [ACTIVE_KEY]
    const wrapper = await mountSuspended(ApiKeyManager)
    const list = wrapper.findComponent({ name: 'ApiKeyList' })

    list.vm.$emit('revoke', ACTIVE_KEY.id)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('已吊销')
  })
})
