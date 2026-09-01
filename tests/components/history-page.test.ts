import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery, readBody } from 'h3'
import HistoryPage from '../../app/pages/history.vue'

const clearHistoryRequests: unknown[] = []
let historyRequestCount = 0

beforeEach(() => {
  clearHistoryRequests.length = 0
  historyRequestCount = 0
})

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
  historyRequestCount += 1
  const query = getQuery(event)
  const page = Number(query.page ?? 1)
  return { data: {
    items: [
      {
        sourceType: 'interest_batch',
        id: '70000000-0000-4000-8000-000000000005',
        kind: 'interest_assessment', subjectType: 'persona', subjectId: '10000000-0000-4000-8000-000000000001',
        subjectName: '林默', subjectExists: true, status: 'partial', description: '3 条文本',
        secondary: '成功 2 / 失败 1', errorCode: null, errorMessage: null, createdAt: 2_500,
      },
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
      {
        sourceType: 'task',
        id: '70000000-0000-4000-8000-000000000004',
        kind: 'openviking_source_sync', subjectType: 'system', subjectId: 'openviking',
        subjectName: 'OpenViking', subjectExists: true, status: 'queued', description: '学院档案',
        secondary: '已尝试 1 / 3 次', errorCode: null, errorMessage: 'OpenViking 请求超时', createdAt: 250,
      },
    ],
    total: 6,
    page,
    pageSize: 5,
    totalPages: 2,
  } }
})
registerEndpoint('/api/v1/history/openviking', {
  method: 'DELETE',
  handler: async (event) => {
    clearHistoryRequests.push(await readBody(event))
    return { data: { deleted: 688 } }
  },
})

describe('统一任务记录页', () => {
  it('展示后台人物记忆提炼批次及排队状态', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history' })
    await flushPromises()

    expect(wrapper.text()).toContain('人物记忆提炼')
    expect(wrapper.text()).toContain('林默')
    expect(wrapper.text()).toContain('排队中')
  })

  it('兴趣批次只显示一条历史记录并进入批次详情', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history' })
    await flushPromises()

    expect(wrapper.text()).toContain('3 条文本')
    expect(wrapper.text()).toContain('成功 2 / 失败 1')
    expect(wrapper.get('a[href="/interest-batches/70000000-0000-4000-8000-000000000005"]').text()).toContain('兴趣判断')
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

  it('OpenViking 排队任务显示类型、尝试次数和最近错误', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history' })
    await flushPromises()

    expect(wrapper.text()).toContain('OpenViking 资料同步')
    expect(wrapper.text()).toContain('已尝试 1 / 3 次')
    expect(wrapper.text()).toContain('OpenViking 请求超时')
    expect(wrapper.get('a[href="/system-records"]').exists()).toBe(true)
  })

  it('确认后清理终态 OpenViking 历史并刷新列表', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history' })
    await flushPromises()
    const initialHistoryRequestCount = historyRequestCount

    await wrapper.findAllComponents({ name: 'UButton' })
      .find(button => button.text() === '清理 OpenViking 历史')!.trigger('click')
    await flushPromises()
    expect(clearHistoryRequests).toHaveLength(0)
    expect(document.body.textContent).toContain('只会删除成功、失败或已取消的 OpenViking 后台任务')

    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认清理')
    expect(confirm).toBeDefined()
    await new DOMWrapper(confirm!).trigger('click')
    await flushPromises()

    expect(clearHistoryRequests).toEqual([{ confirmed: true }])
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('确认清理 OpenViking 历史任务'))
    expect(historyRequestCount).toBeGreaterThan(initialHistoryRequestCount)
    wrapper.unmount()
    document.body.innerHTML = ''
  })
})
