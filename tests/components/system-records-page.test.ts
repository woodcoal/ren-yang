import { getQuery } from 'h3'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import SystemRecordsPage from '../../app/pages/system-records.vue'

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/system/audit/page', (event) => {
  const query = getQuery(event)
  return { data: {
    items: [{
      id: 'audit-1', actor: 'administrator', action: 'data_restored', targetType: 'system', targetId: null,
      details: {}, createdAt: 2_000,
    }],
    total: 6,
    page: Number(query.page ?? 1),
    pageSize: Number(query.pageSize ?? 10),
    totalPages: 2,
  } }
})
registerEndpoint('/api/v1/system/context/records', (event) => {
  const query = getQuery(event)
  return { data: {
    items: [{
      id: 'sync-1', entityType: 'source_material', sourceId: 'source-1', scopeType: 'world', scopeId: 'world-1',
      userId: 'world-1', peerId: null, provider: 'openviking', remoteUri: null, contentHash: 'a'.repeat(64),
      status: 'failed', operation: 'upsert', error: '服务暂时不可用', createdAt: 1_000, updatedAt: 2_000,
    }],
    total: 1,
    page: Number(query.page ?? 1),
    pageSize: Number(query.pageSize ?? 10),
    totalPages: 1,
  } }
})

describe('日志与审计页面', () => {
  it('根据 URL 展示审计记录与准确分页摘要', async () => {
    const wrapper = await mountSuspended(SystemRecordsPage, { route: '/system-records?type=audit&page=2&pageSize=5' })
    await flushPromises()

    expect(wrapper.text()).toContain('同步日志')
    expect(wrapper.text()).toContain('审计记录')
    expect(wrapper.text()).toContain('恢复数据')
    expect(wrapper.text()).toContain('第 2 / 2 页，共 6 项')
    expect(wrapper.get('[aria-label="每页审计记录数量"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('服务暂时不可用')
  })

  it('默认展示同步日志表格', async () => {
    const wrapper = await mountSuspended(SystemRecordsPage, { route: '/system-records' })
    await flushPromises()

    expect(wrapper.text()).toContain('source-1')
    expect(wrapper.text()).toContain('服务暂时不可用')
    expect(wrapper.text()).toContain('第 1 / 1 页，共 1 项')
    expect(wrapper.get('table.content-table').exists()).toBe(true)
  })
})
