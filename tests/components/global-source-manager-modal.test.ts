import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { SourceSummary } from '#shared/types/content'
import GlobalSourceManagerModal from '../../app/components/content/GlobalSourceManagerModal.vue'

/** 测试使用的两项资料。 */
const sources: SourceSummary[] = [
  {
    id: '00000000-0000-4000-8000-000000000001', name: '全局规则', role: 'canon_fact', inputType: 'paste',
    contentHash: 'a'.repeat(64), contentText: '所有人物都要遵守。', originalFilePath: null, isEnabled: true,
    chunkCount: 1, linkCount: 0, isGlobal: true, createdAt: 1, updatedAt: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000002', name: '普通资料', role: 'reference', inputType: 'paste',
    contentHash: 'b'.repeat(64), contentText: '只在需要时选择。', originalFilePath: null, isEnabled: true,
    chunkCount: 1, linkCount: 0, isGlobal: false, createdAt: 1, updatedAt: 1,
  },
]

describe('全局资料管理弹窗', () => {
  it('打开时载入已选集合，支持筛选并提交最终资料 UUID', async () => {
    const wrapper = await mountSuspended(GlobalSourceManagerModal, {
      props: {
        open: true,
        sources,
        selectedSourceIds: [sources[0]!.id],
        loading: false,
      },
    })
    await flushPromises()

    const search = new DOMWrapper(document.querySelector<HTMLInputElement>('input[aria-label="筛选全局资料"]')!)
    expect(document.body.textContent).toContain('已选择 1 项')
    await search.setValue('普通资料')
    await flushPromises()
    expect(document.body.textContent).not.toContain('所有人物都要遵守')

    const checkbox = new DOMWrapper(document.querySelector<HTMLElement>('[aria-label="选择全局资料：普通资料"]')!)
    await checkbox.trigger('click')
    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '保存全局资料')
    await new DOMWrapper(saveButton!).trigger('click')

    expect(wrapper.emitted('save')).toEqual([[[sources[0]!.id, sources[1]!.id]]])
  })
})
