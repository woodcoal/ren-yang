import { describe, expect, it } from 'vitest'
import { assessRevisionRisk, decideRevisionPublication } from '../../server/domain/feedback/RevisionPolicy'
import type { PersonaSnapshot } from '../../shared/types/content'

/** 风险规则测试使用的完整基础人物快照。 */
const BASE_SNAPSHOT: PersonaSnapshot = {
  summary: '谨慎的档案管理员',
  identityFacts: '由用户原创设定。',
  interests: '历史与文献。',
  valuesAndMotivations: '重视证据。',
  expressionStyle: '简洁克制。',
  appearance: '',
  visualStyle: '',
  constraints: '资料不足时说明未知。',
}

describe('人物修订风险与发布门禁', () => {
  it('只把表达风格或兴趣字段的小幅追加判为低风险', () => {
    expect(assessRevisionRisk(BASE_SNAPSHOT, [{ field: 'expressionStyle', after: '简洁克制。避免连续使用感叹号。', reason: '用户长期偏好' }]))
      .toMatchObject({ riskLevel: 'low', autoPublishEligible: true })
    expect(assessRevisionRisk(BASE_SNAPSHOT, [{ field: 'interests', after: '历史与文献。尤其关注档案保存。', reason: '用户长期偏好' }]))
      .toMatchObject({ riskLevel: 'low', autoPublishEligible: true })
  })

  it('把覆盖式偏好修改、多字段修改及身份事实修改提升为高风险', () => {
    expect(assessRevisionRisk(BASE_SNAPSHOT, [{ field: 'interests', after: '只喜欢竞技体育。', reason: '覆盖原偏好' }]))
      .toMatchObject({ riskLevel: 'high', autoPublishEligible: false })
    expect(assessRevisionRisk(BASE_SNAPSHOT, [
      { field: 'expressionStyle', after: '简洁克制。少用修辞。', reason: '表达反馈' },
      { field: 'interests', after: '历史与文献。关注科技。', reason: '兴趣反馈' },
    ])).toMatchObject({ riskLevel: 'high', autoPublishEligible: false })
    expect(assessRevisionRisk(BASE_SNAPSHOT, [{ field: 'identityFacts', after: '来自另一座城市。', reason: '身份变化' }]))
      .toMatchObject({ riskLevel: 'high', autoPublishEligible: false })
  })

  it('把约束修改判为最高风险，并拒绝无实际变化的补丁', () => {
    expect(assessRevisionRisk(BASE_SNAPSHOT, [{ field: 'constraints', after: '可以虚构未知事实。', reason: '修改约束' }]))
      .toMatchObject({ riskLevel: 'critical', autoPublishEligible: false })
    expect(() => assessRevisionRisk(BASE_SNAPSHOT, [{ field: 'expressionStyle', after: '简洁克制。', reason: '没有变化' }]))
      .toThrow('修订补丁必须产生实际变化')
  })

  it('只有当前基础版本、无冲突、评测通过且已启用设置的低风险提案可自动发布', () => {
    expect(decideRevisionPublication({
      riskLevel: 'low', evaluationStatus: 'passed', baseVersionIsActive: true,
      hasEvidenceConflict: false, autoPublishEnabled: true, manualConfirmation: false,
    })).toEqual({ action: 'auto_publish', reason: '低风险提案已通过评测和全部自动发布门禁' })

    expect(decideRevisionPublication({
      riskLevel: 'high', evaluationStatus: 'passed', baseVersionIsActive: true,
      hasEvidenceConflict: false, autoPublishEnabled: true, manualConfirmation: false,
    }).action).toBe('manual_required')
    expect(decideRevisionPublication({
      riskLevel: 'low', evaluationStatus: 'passed', baseVersionIsActive: false,
      hasEvidenceConflict: false, autoPublishEnabled: true, manualConfirmation: true,
    }).action).toBe('blocked')
    expect(decideRevisionPublication({
      riskLevel: 'low', evaluationStatus: 'failed', baseVersionIsActive: true,
      hasEvidenceConflict: false, autoPublishEnabled: true, manualConfirmation: true,
    }).action).toBe('blocked')
  })
})
