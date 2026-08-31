import type { OpenVikingCapabilityView } from '../../shared/types/context'
import type {
  ContextSessionExchange,
  ContextSourceProjection,
  DerivedMemoryDocument,
} from './ContextIndexRepository'
import type { ContextSyncRecordView } from '../../shared/types/context'

/** OpenViking 健康检查的统一业务结果。 */
export interface OpenVikingHealthResult {
  healthy: boolean
  version: string | null
  /** 世界隔离由 ADMIN Key 管理 User、各 User Key 访问数据。 */
  authMode: 'api_key'
  /** 资源处理队列当前是否允许安全写入和全量重建。 */
  queueHealthy: boolean
}

/** OpenViking 索引维护端口，不向应用层暴露远端响应类型。 */
export interface OpenVikingPort {
  /** @returns 非敏感能力配置。 */
  getCapability(): OpenVikingCapabilityView
  /** @returns 远端健康状态。 */
  checkHealth(): Promise<OpenVikingHealthResult>
  /** @param force 是否绕过短期健康缓存。 @returns 处理队列可写时结束。 */
  checkWriteHealth(force?: boolean): Promise<void>
  /** @param userIds SQLite 当前应存在的世界 User。 @returns 创建缺失 User、删除孤立 User 后结束。 */
  reconcileUsers(userIds: string[]): Promise<void>
  /** @param userIds SQLite 当前应存在的世界 User。 @returns 保留 User、清空受管内容并准备按 SQLite 重建后结束。 */
  rebuildUsers(userIds: string[]): Promise<void>
  /** @returns 清理旧版账号共享目录；不存在视为成功。 */
  resetLegacyIndex(): Promise<void>
  /** @param record SQLite 保存的精确投影身份和 URI。 @returns 删除结束；不存在视为成功。 */
  deleteProjection(record: ContextSyncRecordView): Promise<void>
  /** @param projection SQLite 当前资料投影。 @returns 实际远端 URI。 */
  synchronizeProjection(projection: ContextSourceProjection): Promise<string>
  /** @param exchange SQLite 已保存交流。 @returns 提交完成后从 Peer 同步出的候选记忆。 */
  synchronizeSession(exchange: ContextSessionExchange): Promise<DerivedMemoryDocument[]>
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
    public readonly details: {
      /** 是否可通过等待、恢复服务或重新执行解决。 */
      retryable?: boolean
      /** OpenViking 响应中的稳定错误代码。 */
      providerCode?: string | null
      /** 不包含路径参数的请求阶段。 */
      operation?: string | null
      /** OpenViking 请求追踪标识。 */
      requestId?: string | null
    } = {},
  ) {
    super(message)
    this.name = 'OpenVikingError'
  }

  /** @returns 当前错误是否适合自动重试。 */
  get retryable(): boolean {
    return this.details.retryable ?? this.code === 'PROVIDER_UNAVAILABLE'
  }
}
