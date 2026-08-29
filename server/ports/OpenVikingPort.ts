import type { OpenVikingCapabilityView } from '../../shared/types/context'
import type { ContextSourceDocument } from './ContextIndexRepository'

/** OpenViking 健康检查的统一业务结果。 */
export interface OpenVikingHealthResult {
  healthy: boolean
  version: string | null
}

/** OpenViking 索引维护端口，不向应用层暴露远端响应类型。 */
export interface OpenVikingPort {
  /** @returns 非敏感能力配置。 */
  getCapability(): OpenVikingCapabilityView
  /** @returns 远端健康状态。 */
  checkHealth(): Promise<OpenVikingHealthResult>
  /** @returns 删除人样专属远端根目录；不存在视为成功。 */
  resetIndex(): Promise<void>
  /** @param source SQLite 资料完整事实。 @returns 实际远端 URI。 */
  synchronizeSource(source: ContextSourceDocument): Promise<string>
}

/** OpenViking HTTP、结构或能力异常。 */
export class OpenVikingError extends Error {
  /**
   * 创建不含凭据和原始响应的异常。
   * @param code 稳定错误分类。
   * @param message 可安全展示的中文原因。
   */
  constructor(
    public readonly code: 'CAPABILITY_DISABLED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_OUTPUT_INVALID',
    message: string,
  ) {
    super(message)
    this.name = 'OpenVikingError'
  }
}
