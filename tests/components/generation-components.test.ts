import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DocumentSpecEditor from '../../app/components/generation/DocumentSpecEditor.vue'
import EvidenceList from '../../app/components/generation/EvidenceList.vue'
import RunStatusPanel from '../../app/components/generation/RunStatusPanel.vue'
import type { RunSummary } from '../../shared/types/generation'

/** 组件测试使用的固定运行摘要。 */
const RUN: RunSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'interest_assessment',
  personaVersionId: '00000000-0000-4000-8000-000000000002',
  personaId: '00000000-0000-4000-8000-000000000003',
  personaName: '林默',
  status: 'failed',
  input: { content: '课程' },
  scene: null,
  parameters: { temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000, maxEvidenceChunks: 8, maxTextBlocks: 12 },
  model: { provider: 'openai_compatible', model: 'test-model', endpointOrigin: 'https://model.test' },
  promptVersion: 'text-v1',
  contextProvider: 'sqlite_fts5',
  result: null,
  errorCode: 'MODEL_OUTPUT_INVALID',
  errorMessage: '输出结构无效',
  createdAt: 1_000,
  updatedAt: 2_000,
  completedAt: 2_000,
}

describe('阶段三生成组件', () => {
  it('规格编辑器阻止空标题并在修正后提交独立规格', async () => {
    const wrapper = await mountSuspended(DocumentSpecEditor, {
      props: {
        spec: {
          title: '学院观察', summary: '摘要',
          blocks: [{ key: 'title', role: 'heading', instruction: '写标题', acceptanceCriteria: ['简短'], dependsOn: [] }],
        },
      },
    })
    const title = wrapper.findAll('input')[0]!
    await title.setValue('')
    const save = wrapper.findAll('button').find(button => button.text().includes('保存新修订'))!
    await save.trigger('click')
    expect(wrapper.text()).toContain('文档标题不能为空')
    expect(wrapper.emitted('save')).toBeUndefined()

    await title.setValue('新标题')
    await save.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ title: '新标题', blocks: [{ key: 'title' }] })
  })

  it('失败运行只提供重新执行并发出重试意图', async () => {
    const wrapper = await mountSuspended(RunStatusPanel, { props: { run: RUN, tasks: [] } })
    expect(wrapper.text()).toContain('重新执行')
    expect(wrapper.text()).not.toContain('取消运行')

    await wrapper.findAll('button').find(button => button.text().includes('重新执行'))!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('证据正文按文本渲染，不把导入内容解释为 HTML', async () => {
    const wrapper = await mountSuspended(EvidenceList, {
      props: {
        evidence: [{
          id: '00000000-0000-4000-8000-000000000004', sourceId: null, chunkId: null,
          role: 'reference', content: '<script>alert(1)</script>', contentHash: 'a'.repeat(64), rank: 0, metadata: {},
        }],
      },
    })

    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
  })
})
