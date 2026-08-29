import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AnalysisPanel from '../../app/components/analysis/AnalysisPanel.vue'
import IterationProposalCard from '../../app/components/analysis/IterationProposalCard.vue'
import type { AnalysisBatchView, IterationProposalView } from '../../shared/types/analysis'

const proposal: IterationProposalView = {
  id: '70000000-0000-4000-8000-000000000001',
  operation: 'add',
  targetType: 'growth',
  targetIds: [],
  before: [],
  proposed: { content: '先给结论。', scope: '所有写作任务', importance: 4 },
  reviewed: null,
  evidenceInputIds: ['70000000-0000-4000-8000-000000000002'],
  conflicts: [],
  rationale: '多条反馈重复强调先给结论。',
  status: 'pending',
  reviewReason: null,
  reviewedAt: null,
  createdAt: 1,
}

const batch: AnalysisBatchView = {
  id: '70000000-0000-4000-8000-000000000003',
  analysisType: 'persona_growth',
  subjectId: '70000000-0000-4000-8000-000000000004',
  mode: 'incremental',
  status: 'awaiting_review',
  baselineSoulVersionId: '70000000-0000-4000-8000-000000000005',
  inputs: [],
  proposals: [proposal],
  errorCode: null,
  errorMessage: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: 1,
}

describe('成长与记忆分析组件', () => {
  it('分析面板明确区分增量分析与完整重建', async () => {
    const wrapper = await mountSuspended(AnalysisPanel, { props: { batch: null, loading: false, title: '人物成长' } })
    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('analyze')).toEqual([['incremental'], ['full_rebuild']])
    expect(wrapper.text()).toContain('接受前不会改变长期内容')
  })

  it('提案允许管理员编辑后再接受', async () => {
    const wrapper = await mountSuspended(IterationProposalCard, { props: { proposal, loading: false } })
    await wrapper.get('textarea').setValue('每次回答先给简短结论。')
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('所有回答')
    await inputs[1]!.setValue('5')
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('review')).toEqual([[{
      proposalId: proposal.id,
      action: 'accept',
      reviewed: { content: '每次回答先给简短结论。', scope: '所有回答', importance: 5 },
    }]])
  })

  it('已审核提案不再显示重复操作按钮', async () => {
    const wrapper = await mountSuspended(AnalysisPanel, {
      props: {
        batch: { ...batch, status: 'completed', proposals: [{ ...proposal, status: 'applied' }] },
        loading: false,
        title: '人物成长',
      },
    })
    expect(wrapper.text()).toContain('该提案已应用')
    expect(wrapper.text()).not.toContain('接受并应用')
  })
})
