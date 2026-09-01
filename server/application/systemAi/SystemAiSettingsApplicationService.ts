import { systemAiSettingsValuesSchema, type SystemAiSettingsValues } from '../../../shared/schemas/systemAi'
import type { SystemAiSettingsView } from '../../../shared/types/systemAi'
import type { AiConfigurationRepository } from '../../ports/AiConfigurationRepository'
import type { Clock } from '../../ports/Clock'
import type { SystemAiSettingsRepository } from '../../ports/SystemAiSettingsRepository'
import { ApplicationError } from '../errors/ApplicationError'

/** 尚未保存时使用的空默认模型设置。 */
const EMPTY_DEFAULT_MODELS: SystemAiSettingsValues = {
  textModelDeploymentId: '',
  imageModelDeploymentId: '',
}

/** 默认模型设置应用服务依赖。 */
export interface SystemAiSettingsApplicationServiceDependencies {
  /** 默认模型设置事实源。 */
  repository: SystemAiSettingsRepository
  /** 模型部署及所属连接事实源。 */
  aiConfiguration: Pick<AiConfigurationRepository, 'findConnection' | 'findModelDeployment'>
  /** 保存设置使用的时钟。 */
  clock: Clock
}

/** 读取和保存全站默认文本与图片模型。 */
export class SystemAiSettingsApplicationService {
  /** @param dependencies 设置仓储、模型配置仓储和时钟。 */
  constructor(private readonly dependencies: SystemAiSettingsApplicationServiceDependencies) {}

  /** @returns 当前默认模型；尚未保存时返回两个空选择。 */
  async getSettings(): Promise<SystemAiSettingsView> {
    const saved = await this.dependencies.repository.find()
    return saved ?? { values: { ...EMPTY_DEFAULT_MODELS }, updatedAt: null }
  }

  /**
   * 校验并完整保存默认文本与图片模型。
   * @param values 两类默认模型的完整部署选择，空字符串表示未设置。
   * @returns 保存后的默认模型设置。
   */
  async updateSettings(values: SystemAiSettingsValues): Promise<SystemAiSettingsView> {
    const normalized = systemAiSettingsValuesSchema.parse(values)
    await Promise.all([
      this.requireEnabledDeployment(normalized.textModelDeploymentId, 'text'),
      this.requireEnabledDeployment(normalized.imageModelDeploymentId, 'image'),
    ])
    return await this.dependencies.repository.save(normalized, this.dependencies.clock.now())
  }

  /**
   * 校验非空默认部署及其所属接口当前可用于新任务。
   * @param deploymentId 可为空的模型部署 UUID。
   * @param modality 该默认项要求的文本或图片类型。
   * @returns 空选择或校验通过时结束。
   */
  private async requireEnabledDeployment(deploymentId: string, modality: 'text' | 'image'): Promise<void> {
    if (!deploymentId) return
    const deployment = await this.dependencies.aiConfiguration.findModelDeployment(deploymentId)
    if (!deployment || deployment.modality !== modality || !deployment.isEnabled) {
      throw new ApplicationError('VALIDATION_FAILED', `${modality === 'text' ? '文本' : '图片'}模型部署无效或未启用`, 422)
    }
    const connection = await this.dependencies.aiConfiguration.findConnection(deployment.connectionId)
    if (!connection?.isEnabled) {
      throw new ApplicationError('VALIDATION_FAILED', `${modality === 'text' ? '文本' : '图片'}模型所属接口未启用`, 422)
    }
  }
}
