import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { PersonaSummary } from '../../shared/types/content'
import WorldPersonaList from '../../app/components/content/WorldPersonaList.vue'

/**
 * 创建世界人物管理测试使用的完整人物摘要。
 * @param id 人物 UUID。
 * @param name 人物名称。
 * @param worldId 当前世界 UUID；null 表示独立人物。
 * @returns 字段稳定的人物摘要。
 */
function createPersonaSummary(id: string, name: string, worldId: string | null): PersonaSummary {
  return {
    id,
    worldId,
    worldName: worldId ? '已有世界' : null,
    name,
    avatarUrl: null,
    origin: 'original',
    activeVersionId: null,
    currentSummary: null,
    isEnabled: true,
    versionCount: 1,
    sourceCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
  }
}

describe('世界人物关系管理', () => {
  it('按部分名称搜索独立人物并发出添加和移除事件', async () => {
    const currentWorldId = '00000000-0000-4000-8000-000000000001'
    const otherWorldId = '00000000-0000-4000-8000-000000000002'
    const linked = createPersonaSummary('10000000-0000-4000-8000-000000000001', '档案员', currentWorldId)
    const independent = createPersonaSummary('10000000-0000-4000-8000-000000000002', '林默', null)
    const occupied = createPersonaSummary('10000000-0000-4000-8000-000000000003', '林墨', otherWorldId)
    const wrapper = await mountSuspended(WorldPersonaList, {
      props: {
        personas: [linked],
        availablePersonas: [linked, independent, occupied],
        loading: false,
      },
    })

    await wrapper.get('input[aria-label="搜索可添加人物"]').setValue('林')
    await flushPromises()

    expect(wrapper.text()).toContain('林默')
    expect(wrapper.text()).not.toContain('林墨')
    await wrapper.findAll('button').find(button => button.text() === '添加')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '移除')!.trigger('click')

    expect(wrapper.emitted('add')).toEqual([[independent]])
    expect(wrapper.emitted('remove')).toEqual([[linked]])
  })
})
