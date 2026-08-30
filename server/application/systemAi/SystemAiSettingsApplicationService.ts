import type { SystemAiSettingsValues } from '../../../shared/schemas/systemAi'
import { systemAiSettingsValuesSchema } from '../../../shared/schemas/systemAi'
import type { TextModelParameters } from '../../../shared/schemas/generation'
import type { SystemAiOperation, SystemAiSettingsView } from '../../../shared/types/systemAi'
import type { Clock } from '../../ports/Clock'
import type { SystemAiSettingsRepository } from '../../ports/SystemAiSettingsRepository'

/** 尚未保存自定义设置时使用的系统 AI 参数。 */
export const DEFAULT_SYSTEM_AI_SETTINGS: SystemAiSettingsValues = {
  interestAnalysis: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000, maxEvidenceChunks: 8 },
  contentAnalysis: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
  draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
  feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
}

/** 系统 AI 设置应用服务依赖。 */
export interface SystemAiSettingsApplicationServiceDependencies {
  /** 当前设置事实源。 */
  repository: SystemAiSettingsRepository
  /** 保存设置使用的可测试时钟。 */
  clock: Clock
}

/** 读取、保存并按业务场景合并系统 AI 参数。 */
export class SystemAiSettingsApplicationService {
  /** @param dependencies 设置事实源与时钟。 */
  constructor(private readonly dependencies: SystemAiSettingsApplicationServiceDependencies) {}

  /** @returns 当前设置；尚未自定义时返回独立的默认值副本。 */
  async getSettings(): Promise<SystemAiSettingsView> {
    const saved = await this.dependencies.repository.find()
    if (saved) return saved
    return { values: systemAiSettingsValuesSchema.parse(DEFAULT_SYSTEM_AI_SETTINGS), updatedAt: null }
  }

  /** @param values 四类完整参数。 @returns 保存后的当前设置。 */
  async updateSettings(values: SystemAiSettingsValues): Promise<SystemAiSettingsView> {
    const normalized = systemAiSettingsValuesSchema.parse(values)
    return await this.dependencies.repository.save(normalized, this.dependencies.clock.now())
  }

  /**
   * 把目标系统 AI 场景的可配置字段覆盖到调用方固定安全参数。
   * @param operation 系统 AI 业务场景。
   * @param defaults 调用方保留的提示预算和图文限制等固定参数。
   * @returns 合并后的完整文本模型参数。
   */
  async resolveParameters(operation: SystemAiOperation, defaults: TextModelParameters): Promise<TextModelParameters> {
    const settings = await this.getSettings()
    return { ...defaults, ...settings.values[operation] }
  }
}
