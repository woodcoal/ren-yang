import { describe, expect, it } from 'vitest'
import { LearningAutomationApplicationService } from '../../server/application/learningAutomation/LearningAutomationApplicationService'
import type { AnalysisType } from '../../shared/types/analysis'

/** 构造仅覆盖自动提炼调度所需行为的测试服务。 */
function createService(due: boolean) {
  const created: Array<{ analysisType: AnalysisType, subjectId: string }> = []
  const service = new LearningAutomationApplicationService({
    settings: {
      async find() {
        return { intervalHours: 24, nextRunAt: 1_000, lastRunAt: null, updatedAt: 0 }
      },
      async update() {
        throw new Error('测试不应修改周期')
      },
      async claimDueCycle() {
        return due
      },
    },
    content: {
      async listWorlds() {
        return [
          { id: 'world-enabled', isEnabled: true, automaticLearningEnabled: true },
          { id: 'world-disabled', isEnabled: false, automaticLearningEnabled: true },
          { id: 'world-off', isEnabled: true, automaticLearningEnabled: false },
        ]
      },
      async listPersonas() {
        return [
          { id: 'persona-enabled', isEnabled: true, automaticLearningEnabled: true },
          { id: 'persona-off', isEnabled: true, automaticLearningEnabled: false },
        ]
      },
    },
    analysis: {
      async createBatch(analysisType, subjectId) {
        created.push({ analysisType, subjectId })
        return { id: `${analysisType}-${subjectId}` }
      },
    },
    clock: { now: () => 1_000 },
  })
  return { service, created }
}

describe('定时学习自动化应用服务', () => {
  it('周期未到时不扫描也不创建任务', async () => {
    const { service, created } = createService(false)

    await expect(service.runDueCycle()).resolves.toEqual({ claimed: false, queued: 0, skipped: 0 })
    expect(created).toEqual([])
  })

  it('周期到达后只为已启用且打开开关的对象创建自动发布批次', async () => {
    const { service, created } = createService(true)

    await expect(service.runDueCycle()).resolves.toEqual({ claimed: true, queued: 3, skipped: 0 })
    expect(created).toEqual([
      { analysisType: 'world_growth', subjectId: 'world-enabled' },
      { analysisType: 'persona_growth', subjectId: 'persona-enabled' },
      { analysisType: 'persona_memory', subjectId: 'persona-enabled' },
    ])
  })
})
