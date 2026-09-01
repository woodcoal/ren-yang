import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicApiDocsPage from '../../app/pages/api/v2/docs.vue'
import { createPublicOpenApiDocument } from '../../server/openapi/publicApiDocument'

registerEndpoint('/api/v2/openapi.json', () => createPublicOpenApiDocument())

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('公共 API 交互文档', () => {
  it('从唯一 OpenAPI 契约展示全部 v2 接口和权限，不混入内部接口', async () => {
    const wrapper = await mountSuspended(PublicApiDocsPage, { route: '/api/v2/docs' })

    expect(wrapper.text()).toContain('/api/v2/personas')
    expect(wrapper.text()).toContain('/api/v2/worlds')
    expect(wrapper.text()).toContain('/api/v2/sources')
    expect(wrapper.text()).toContain('persona:read')
    expect(wrapper.text()).toContain('library:write')
    expect(wrapper.text()).toContain('响应字段')
    expect(wrapper.text()).toContain('contentText')
    expect(wrapper.text()).not.toContain('/api/v1')
  })

  it('API Key 使用密码输入且请求示例不泄露当前明文', async () => {
    const wrapper = await mountSuspended(PublicApiDocsPage, { route: '/api/v2/docs' })
    const keyInput = wrapper.get('[data-testid="api-key-input"]')

    await keyInput.setValue('ry_v2_once_only_secret')

    expect(keyInput.attributes('type')).toBe('password')
    expect(wrapper.text()).toContain('Bearer <api_key>')
    expect(wrapper.text()).not.toContain('ry_v2_once_only_secret')
  })

  it('按契约构造 Bearer 请求并展示试调响应', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { items: [] },
      meta: { requestId: '00000000-0000-4000-8000-000000000099' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', request)
    const wrapper = await mountSuspended(PublicApiDocsPage, { route: '/api/v2/docs' })

    await wrapper.get('[data-testid="api-key-input"]').setValue('ry_v2_test_secret')
    await wrapper.find('.api-operation button').trigger('click')
    await flushPromises()

    expect(request).toHaveBeenCalledOnce()
    const [url, options] = request.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/v2/personas?page=1&pageSize=10&status=all&sort=updatedAt&order=desc')
    expect((options.headers as Headers).get('Authorization')).toBe('Bearer ry_v2_test_secret')
    expect(wrapper.get('[data-testid="try-response"]').text()).toContain('00000000-0000-4000-8000-000000000099')
  })
})
