import { readBody } from 'h3'
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

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/sources/page', () => ({
  data: { items: sourceItems, total: sourceItems.length, page: 1, pageSize: 10, totalPages: 1 },
}))
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
  it('可批量启用禁用资料并保持禁用二次确认', async () => {
    const wrapper = await mountSuspended(SourceListPage, { route: '/sources' })
    await flushPromises()

    const batchToolbar = wrapper.get('div.content-toolbar')
    const batchEnable = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量启用')!
    const batchDisable = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '批量禁用')!
    expect(batchToolbar.classes()).toEqual(expect.arrayContaining(['!rounded-none', '!bg-transparent', '!border-0']))
    expect(batchEnable.props()).toMatchObject({ size: 'xs', variant: 'ghost' })
    expect(batchDisable.props()).toMatchObject({ size: 'xs', variant: 'ghost' })
    const detailsButton = wrapper.findAllComponents({ name: 'UButton' })
      .find(button => button.props('icon') === 'i-lucide-chevron-right')
    expect(detailsButton).toBeDefined()
    expect(detailsButton!.props()).toMatchObject({ icon: 'i-lucide-chevron-right', size: 'xs', variant: 'ghost' })
    expect(wrapper.get('a[aria-label="查看与维护：已启用资料"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('已选择')

    const disabledCheckbox = wrapper.get('input[aria-label="选择资料：已禁用资料"]')
    expect(disabledCheckbox.attributes('disabled')).toBeUndefined()
    await disabledCheckbox.setValue(true)
    expect(wrapper.text()).toContain('已选择 1 项资料')
    await batchEnable.trigger('click')
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
})
