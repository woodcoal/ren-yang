import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AnalysisPanel from '../../app/components/analysis/AnalysisPanel.vue'
import type { AnalysisBatchView } from '../../shared/types/analysis'

/** 已完成并生成完整草稿的分析批次。 */
const completedBatch: AnalysisBatchView = {
  id: '70000000-0000-4000-8000-000000000003',
  analysisType: 'persona_growth',
  subjectId: '70000000-0000-4000-8000-000000000004',
  mode: 'incremental',
  status: 'completed',
  baselineSoulVersionId: '70000000-0000-4000-8000-000000000005',
  inputs: [],
  proposals: [],
  resultSummary: '综合表达素材，补充了结论先行和不确定性标注。',
  errorCode: null,
  errorMessage: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: 1,
}

describe('成长与记忆 AI 提炼组件', () => {
  it('人物和世界详情页显式使用完整提示词提炼面板', () => {
    const pageSources = [
      readFileSync('app/pages/personas/[id].vue', 'utf8'),
      readFileSync('app/pages/worlds/[id].vue', 'utf8'),
    ]
    for (const pageSource of pageSources) {
      expect(pageSource).toContain("import AnalysisPanel from '../../components/analysis/AnalysisPanel.vue'")
      expect(pageSource).toContain('LearningPromptPanel')
      expect(pageSource).not.toContain('@review=')
    }
  })

  it('提炼面板明确区分结合新增素材与全部素材重建', async () => {
    const wrapper = await mountSuspended(AnalysisPanel, { props: { batch: null, loading: false, title: '人物成长' } })
    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('analyze')).toEqual([['incremental'], ['full_rebuild']])
    expect(wrapper.text()).toContain('人工校准并发布后才会生效')
    expect(wrapper.text()).not.toContain('提案')
  })

  it('完成后展示提炼摘要并引导校准发布草稿', async () => {
    const wrapper = await mountSuspended(AnalysisPanel, {
      props: { batch: completedBatch, loading: false, title: '人物成长' },
    })
    expect(wrapper.text()).toContain('完整提示词草稿已生成')
    expect(wrapper.text()).toContain('请在下方校准草稿')
    expect(wrapper.text()).toContain('综合表达素材')
    expect(wrapper.text()).not.toContain('接受并应用')
  })
})
