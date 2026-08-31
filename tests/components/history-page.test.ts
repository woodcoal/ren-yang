import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import HistoryPage from '../../app/pages/history.vue'

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/personas', () => ({
  data: [{
    id: '10000000-0000-4000-8000-000000000001', worldId: null, worldName: null, name: '林默', origin: 'original',
    activeVersionId: '11000000-0000-4000-8000-000000000001', currentSummary: '档案员', isEnabled: true,
    versionCount: 1, sourceCount: 0, createdAt: 1_000, updatedAt: 1_000,
  }],
}))
registerEndpoint('/api/v1/history', (event) => {
  const query = getQuery(event)
  const page = Number(query.page ?? 1)
  return { data: {
    items: [
      {
        sourceType: 'analysis',
        id: '70000000-0000-4000-8000-000000000001',
        kind: 'persona_memory', subjectType: 'persona', subjectId: '10000000-0000-4000-8000-000000000001',
        subjectName: '林默', subjectExists: true, status: 'queued', description: '0 项原始素材',
        secondary: '结合新增素材', errorCode: null, errorMessage: null, createdAt: 2_000,
      },
      {
        sourceType: 'run',
        id: '70000000-0000-4000-8000-000000000002',
        kind: 'artifact_generation', subjectType: 'persona', subjectId: '10000000-0000-4000-8000-000000000001',
        subjectName: '林默', subjectExists: true, status: 'failed', description: '生成一篇人物小传',
        secondary: '测试模型', errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: '模型服务暂时不可用', createdAt: 1_000,
      },
      {
        sourceType: 'analysis',
        id: '70000000-0000-4000-8000-000000000003',
        kind: 'persona_growth', subjectType: 'persona', subjectId: '10000000-0000-4000-8000-000000000001',
        subjectName: '林默', subjectExists: true, status: 'failed', description: '1 项原始素材',
        secondary: '结合新增素材', errorCode: null, errorMessage: null, createdAt: 500,
      },
    ],
    total: 6,
    page,
    pageSize: 5,
    totalPages: 2,
  } }
})

describe('统一任务记录页', () => {
  it('展示后台人物记忆提炼批次及排队状态', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history' })
    await flushPromises()

    expect(wrapper.text()).toContain('人物记忆提炼')
    expect(wrapper.text()).toContain('林默')
    expect(wrapper.text()).toContain('排队中')
  })

  it('根据 URL 展示第二页与准确的分页摘要', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history?page=2&pageSize=5' })
    await flushPromises()

    expect(wrapper.text()).toContain('第 2 / 2 页，共 6 项')
    expect(wrapper.get('[aria-label="每页任务数量"]').exists()).toBe(true)
  })

  it('失败任务在列表状态下显示错误码和失败原因', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history' })
    await flushPromises()

    expect(wrapper.text()).toContain('PROVIDER_UNAVAILABLE：模型服务暂时不可用')
    expect(wrapper.text()).toContain('未记录失败原因')
  })
})
