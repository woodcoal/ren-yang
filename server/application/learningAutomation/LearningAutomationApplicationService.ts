import type { UpdateLearningAutomationSettingsInput } from '../../../shared/schemas/learningAutomation'
import type { LearningAutomationSettingsView } from '../../../shared/types/learningAutomation'
import type { AnalysisType } from '../../../shared/types/analysis'
import type { Clock } from '../../ports/Clock'
import type { LearningAutomationSettingsRepository } from '../../ports/LearningAutomationSettingsRepository'
import { ApplicationError } from '../errors/ApplicationError'

/** 自动调度只需读取的对象状态。 */
interface AutomaticLearningSubject {
  /** 对象 UUID。 */
  id: string
  /** 对象是否允许进入新任务。 */
  isEnabled: boolean
  /** 是否允许定时提炼并发布。 */
  automaticLearningEnabled: boolean
}

/** 学习自动化应用服务依赖。 */
export interface LearningAutomationApplicationServiceDependencies {
  /** 单例周期设置和到期领取端口。 */
  settings: LearningAutomationSettingsRepository
  /** 人物与世界列表。 */
  content: {
    listWorlds(): Promise<AutomaticLearningSubject[]>
    listPersonas(): Promise<AutomaticLearningSubject[]>
  }
  /** 分析批次创建入口。 */
  analysis: {
    createBatch(analysisType: AnalysisType, subjectId: string, input: { mode: 'incremental' }, options: { autoPublish: true }): Promise<unknown>
  }
  /** 可测试时钟。 */
  clock: Clock
}

/** 按后台统一周期为明确开启的对象创建自动发布分析批次。 */
export class LearningAutomationApplicationService {
  /** @param dependencies 周期设置、内容、分析和时间端口。 */
  constructor(private readonly dependencies: LearningAutomationApplicationServiceDependencies) {}

  /** @returns 当前统一周期设置。 */
  async getSettings(): Promise<LearningAutomationSettingsView> {
    return await this.dependencies.settings.find()
  }

  /** @param input 已校验的新周期。 @returns 持久化并重算下次执行时间后的设置。 */
  async updateSettings(input: UpdateLearningAutomationSettingsInput): Promise<LearningAutomationSettingsView> {
    return await this.dependencies.settings.update(input.intervalHours, this.dependencies.clock.now())
  }

  /**
   * 原子领取到期周期并创建各对象的增量自动发布批次。
   * @returns 是否领取周期及创建、跳过的任务数。
   */
  async runDueCycle(): Promise<{ claimed: boolean, queued: number, skipped: number }> {
    const timestamp = this.dependencies.clock.now()
    if (!await this.dependencies.settings.claimDueCycle(timestamp)) return { claimed: false, queued: 0, skipped: 0 }
    const [worlds, personas] = await Promise.all([
      this.dependencies.content.listWorlds(),
      this.dependencies.content.listPersonas(),
    ])
    const targets: Array<{ analysisType: AnalysisType, subjectId: string }> = [
      ...worlds.filter(isAutomaticSubject).map(world => ({ analysisType: 'world_growth' as const, subjectId: world.id })),
      ...personas.filter(isAutomaticSubject).flatMap(persona => [
        { analysisType: 'persona_growth' as const, subjectId: persona.id },
        { analysisType: 'persona_memory' as const, subjectId: persona.id },
      ]),
    ]
    let queued = 0
    let skipped = 0
    for (const target of targets) {
      try {
        await this.dependencies.analysis.createBatch(target.analysisType, target.subjectId, { mode: 'incremental' }, { autoPublish: true })
        queued += 1
      }
      catch (error: unknown) {
        if (!isSkippableAnalysisError(error)) throw error
        skipped += 1
      }
    }
    return { claimed: true, queued, skipped }
  }
}

/** @param subject 人物或世界状态。 @returns 是否允许当前周期自动提炼。 */
function isAutomaticSubject(subject: AutomaticLearningSubject): boolean {
  return subject.isEnabled && subject.automaticLearningEnabled
}

/** @param error 分析创建异常。 @returns 是否属于单对象可跳过的预期状态。 */
function isSkippableAnalysisError(error: unknown): boolean {
  return error instanceof ApplicationError && [
    'NO_NEW_ANALYSIS_INPUT',
    'ANALYSIS_INPUT_REQUIRED',
    'ANALYSIS_ALREADY_PENDING',
    'SOUL_VERSION_MISSING',
    'CAPABILITY_DISABLED',
  ].includes(error.code)
}
