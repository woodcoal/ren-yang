import { getQuery, readBody } from 'h3'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { UpdateSourcesStatusInput } from '#shared/schemas/content'
import type { SourceSummary } from '#shared/types/content'
import SourceListPage from '../../app/pages/sources/index.vue'

const enabledSourceId = '00000000-0000-4000-8000-000000000001'
const disabledSourceId = '00000000-0000-4000-8000-000000000002'
let sourceItems: SourceSummary[] = [
  {
    id: enabledSourceId, name: '已启用资料', role: 'reference', inputType: 'paste', contentHash: 'a'.repeat(64),
    contentText: '当前可以进入检索。', originalFilePath: null, isEnabled: true, chunkCount: 1, linkCount: 0,
    createdAt: 1_000, updatedAt: 1_000,
  },
  {
    id: disabledSourceId, name: '已禁用资料', role: 'reference', inputType: 'paste', contentHash: 'b'.repeat(64),
    contentText: '当前不会进入检索。', originalFilePath: null, isEnabled: false, chunkCount: 1, linkCount: 0,
    createdAt: 2_000, updatedAt: 2_000,
  },
]
const statusRequests: UpdateSourcesStatusInput[] = []
const sourcePageQueries: Array<Record<string, string | string[] | undefined>> = []

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/sources/page', (event) => {
  const query = getQuery(event)
  sourcePageQueries.push(query)
  const keyword = typeof query.query === 'string' ? query.query : ''
  const items = sourceItems.filter(source => source.name.includes(keyword))
  return { data: { items, total: items.length, page: 1, pageSize: 10, totalPages: 1 } }
})
registerEndpoint('/api/v1/personas', () => ({ data: [] }))
registerEndpoint('/api/v1/worlds', () => ({ data: [] }))
registerEndpoint('/api/v1/sources/status', {
  method: 'PATCH',
  handler: async (event) => {
    const input = await readBody<UpdateSourcesStatusInput>(event)
    statusRequests.push(input)
    sourceItems = sourceItems.map(source => input.sourceIds.includes(source.id)
      ? { ...source, isEnabled: input.isEnabled }
      : source)
    return { data: input }
  },
})

describe('资料列表批量状态操作', () => {
  it('批量启用与禁用资料均需二次确认', async () => {
    const wrapper = await mountSuspended(SourceListPage, { route: '/sources' })
    await flushPromises()

    const batchToolbar = wrapper.get('div.list-management-batch')
    const batchEnable = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量启用')!
    const batchDisable = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量禁用')!
    expect(batchToolbar.classes()).toContain('list-management-batch')
    expect(batchEnable.props()).toMatchObject({ size: 'xs', variant: 'soft', icon: 'i-lucide-circle-check' })
    expect(batchDisable.props()).toMatchObject({ size: 'xs', variant: 'soft', icon: 'i-lucide-circle-off' })
    const detailsButton = wrapper.findAllComponents({ name: 'UButton' })
      .find(button => button.props('icon') === 'i-lucide-chevron-right')
    expect(detailsButton).toBeDefined()
    expect(detailsButton!.props()).toMatchObject({ icon: 'i-lucide-chevron-right', size: 'xs', variant: 'ghost' })
    expect(wrapper.get('a[data-source-title-link]').attributes('href')).toBe(`/sources/${enabledSourceId}`)
    expect(wrapper.get('a[aria-label="查看与维护：已启用资料"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('已选择')

    const disabledCheckbox = wrapper.get('input[aria-label="选择资料：已禁用资料"]')
    expect(disabledCheckbox.attributes('disabled')).toBeUndefined()
    await disabledCheckbox.setValue(true)
    expect(wrapper.text()).toContain('已选择 1 项资料')
    await batchEnable.trigger('click')
    await flushPromises()

    expect(statusRequests).toHaveLength(0)
    const confirmEnableButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认启用')
    expect(confirmEnableButton).toBeDefined()
    await new DOMWrapper(confirmEnableButton!).trigger('click')
    await flushPromises()
    expect(statusRequests).toEqual([{ sourceIds: [disabledSourceId], isEnabled: true }])
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('已选择'))

    await wrapper.get('input[aria-label="选择资料：已启用资料"]').setValue(true)
    await wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量禁用')!.trigger('click')
    await flushPromises()
    expect(statusRequests).toHaveLength(1)
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认禁用')
    expect(confirmButton).toBeDefined()
    await new DOMWrapper(confirmButton!).trigger('click')
    await flushPromises()

    expect(statusRequests).toEqual([
      { sourceIds: [disabledSourceId], isEnabled: true },
      { sourceIds: [enabledSourceId], isEnabled: false },
    ])
  })

  it('段落搜索使用独立结果页，资料项目按名称进行服务端筛选', async () => {
    const wrapper = await mountSuspended(SourceListPage, { route: '/sources' })
    await flushPromises()

    expect(wrapper.get('a[href="/sources/search"]').text()).toBe('全文检索')
    expect(wrapper.text()).toContain('进入独立搜索页')

    const requestCount = sourcePageQueries.length
    await wrapper.get('input[aria-label="资料列表搜索词"]').setValue('禁用')
    await wrapper.get('form[aria-label="筛选资料项目"]').trigger('submit')
    await vi.waitFor(() => expect(sourcePageQueries.length).toBeGreaterThan(requestCount))
    expect(sourcePageQueries.at(-1)).toMatchObject({ query: '禁用', page: '1' })
    await vi.waitFor(() => expect(wrapper.text()).toContain('已禁用资料'))
    expect(wrapper.text()).not.toContain('已启用资料')
  })
})
