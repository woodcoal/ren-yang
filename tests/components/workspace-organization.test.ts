import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SourceTargetPicker from '../../app/components/content/SourceTargetPicker.vue'
import type { DeletionImpact, PersonaSummary, WorldSummary } from '../../shared/types/content'

/** 用于验证资料关系分组的人物。 */
const persona: PersonaSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  worldId: null,
  worldName: null,
  name: '林默',
  avatarUrl: null,
  origin: 'original',
  activeVersionId: null,
  currentSummary: null,
  isEnabled: true,
  versionCount: 1,
  sourceCount: 1,
  createdAt: 1,
  updatedAt: 1,
}

/** 用于验证名称模糊搜索新增关系的第二个人物。 */
const secondPersona: PersonaSummary = {
  ...persona,
  id: '10000000-0000-4000-8000-000000000002',
  name: '许知遥',
}

/** 用于验证资料关系分组的世界。 */
const world: WorldSummary = {
  id: '20000000-0000-4000-8000-000000000001',
  name: '浮岛纪元',
  summary: '',
  activeVersionId: null,
  currentContent: null,
  isEnabled: true,
  versionCount: 1,
  personaCount: 1,
  sourceCount: 1,
  createdAt: 1,
  updatedAt: 1,
}

/** 人物删除影响完整展示使用的固定数据。 */
const personaDeletionImpact: DeletionImpact = {
  resourceType: 'persona',
  resourceId: persona.id,
  canDelete: true,
  blockers: [],
  relatedPersonas: [],
  relatedWorlds: [],
  relatedSources: [{ id: '30000000-0000-4000-8000-000000000001', name: '人物参考资料' }],
  versionCount: 3,
  runHistory: {
    runs: 2,
    tasks: 4,
    evidenceSnapshots: 5,
    documentSpecs: 1,
    artifactBlocks: 6,
    blockAttempts: 7,
  },
  files: [`avatars/${persona.id}`, 'artifacts/run-1'],
}

describe('详情工作区信息架构', () => {
  it('人物和世界只保留四个顶层入口并在内部声明提示词与资料模块', () => {
    const personaPage = readFileSync('app/pages/personas/[id].vue', 'utf8')
    const worldPage = readFileSync('app/pages/worlds/[id].vue', 'utf8')

    for (const pageSource of [personaPage, worldPage]) {
      expect(pageSource).toContain("{ id: 'basic', label: '基础信息' }")
      expect(pageSource).toContain("{ id: 'prompts', label: '提示词' }")
      expect(pageSource).toContain("{ id: 'materials', label: '资料' }")
      expect(pageSource).toContain("{ id: 'operations', label: '操作' }")
      expect(pageSource).toContain('ContentWorkspaceModuleNav')
      expect(pageSource).toContain('ContentLifecycleOperationsPanel')
    }
    expect(personaPage).toContain("{ id: 'memory', label: '记忆'")
    expect(personaPage).toContain("{ id: 'records', label: '历史任务'")
    expect(personaPage).toContain("{ id: 'external_records', label: '三方记录'")
    expect(worldPage).not.toContain("{ id: 'memory', label: '记忆'")
  })

  it('资料详情将启停和删除统一放入最后的操作入口', () => {
    const sourcePage = readFileSync('app/pages/sources/[id].vue', 'utf8')

    expect(sourcePage).toContain("'body' | 'chunks' | 'relations' | 'operations'")
    expect(sourcePage).toContain('>操作</button>')
    expect(sourcePage).toContain('ContentLifecycleOperationsPanel')
    expect(sourcePage).not.toContain('>删除资料</button>')
  })

  it('资料关系按人物和世界分组展示并可逐项移除', async () => {
    const wrapper = await mountSuspended(SourceTargetPicker, {
      props: {
        personas: [persona, secondPersona],
        worlds: [world],
        disabled: false,
        showSelectedGroups: true,
        modelValue: [
          { targetType: 'persona', targetId: persona.id },
          { targetType: 'world', targetId: world.id },
        ],
      },
    })

    expect(wrapper.text()).toContain('已选人物（1）')
    expect(wrapper.text()).toContain('已选世界（1）')
    expect(wrapper.get(`a[href="/personas/${persona.id}"]`).text()).toBe(persona.name)
    expect(wrapper.get(`a[href="/worlds/${world.id}"]`).text()).toBe(world.name)
    await wrapper.get(`button[aria-label="移除人物关系：${persona.name}"]`).trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[
      { targetType: 'world', targetId: world.id },
    ]])
    await wrapper.get('input[aria-label="搜索可添加人物或世界"]').setValue('知遥')
    await wrapper.get(`button[aria-label="添加人物关系：${secondPersona.name}"]`).trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[
      { targetType: 'world', targetId: world.id },
      { targetType: 'persona', targetId: secondPersona.id },
    ]])
  })

  it('统一操作面板完整提示人物删除影响', async () => {
    const LifecycleOperationsPanel = await import('../../app/components/content/LifecycleOperationsPanel.vue')
    const wrapper = await mountSuspended(LifecycleOperationsPanel.default, {
      props: {
        subjectType: 'persona',
        subjectName: persona.name,
        isEnabled: true,
        deletionImpact: personaDeletionImpact,
        loading: false,
      },
    })

    expect(wrapper.text()).toContain('永久且不可恢复')
    expect(wrapper.text()).toContain('3 个灵魂版本')
    expect(wrapper.text()).toContain('2 次任务记录')
    expect(wrapper.text()).toContain('4 个后台任务')
    expect(wrapper.text()).toContain('人物参考资料')
    expect(wrapper.text()).toContain('2 项本地文件或目录')
  })
})
