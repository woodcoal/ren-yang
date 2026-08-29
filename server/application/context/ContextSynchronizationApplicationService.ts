import type { ContextReindexResult, ContextSyncRecordView } from '../../../shared/types/context'
import type { Clock } from '../../ports/Clock'
import type { ContextIndexRepository } from '../../ports/ContextIndexRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { OpenVikingPort } from '../../ports/OpenVikingPort'
import { OpenVikingError } from '../../ports/OpenVikingPort'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import { ApplicationError } from '../errors/ApplicationError'

/** 上下文索引同步应用服务依赖。 */
export interface ContextSynchronizationApplicationServiceDependencies {
  /** SQLite 资料与同步事实源。 */
  repository: ContextIndexRepository
  /** OpenViking 外部能力端口。 */
  openViking: OpenVikingPort
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
}

/** 从 SQLite 唯一事实源检测和重建可选 OpenViking 索引。 */
export class ContextSynchronizationApplicationService implements TaskHandler {
  /**
   * 创建上下文同步服务。
   * @param dependencies SQLite 目录、OpenViking、标识和时钟。
   */
  constructor(private readonly dependencies: ContextSynchronizationApplicationServiceDependencies) {}

  /** @returns OpenViking 非敏感能力状态。 */
  getCapability() {
    return this.dependencies.openViking.getCapability()
  }

  /** @returns 当前全部资料同步事实。 */
  async listSyncRecords(): Promise<ContextSyncRecordView[]> {
    return await this.dependencies.repository.listSyncRecords()
  }

  /** @returns 主动联网检测结果；不修改索引或开关。 */
  async checkProvider() {
    this.requireConfigured(false)
    try {
      return await this.dependencies.openViking.checkHealth()
    }
    catch (error: unknown) {
      throw toApplicationError(error)
    }
  }

  /**
   * 执行 Worker 已领取的单资料同步任务。
   * @param job 类型为 sync_context_source 的持久任务。
   * @returns SQLite 当前资料写入远端并保存同步事实后结束。
   */
  async execute(job: TaskJob): Promise<void> {
    if (job.type !== 'sync_context_source') throw new Error(`上下文同步服务未注册任务类型：${job.type}`)
    const sourceId = readSourceId(job.payloadJson)
    await this.synchronizeSource(sourceId)
  }

  /**
   * 读取 SQLite 最新资料并同步单个稳定远端 URI；资料已删除时任务安全结束。
   * @param sourceId 资料 UUID。
   * @returns 同步完成时结束；外部故障保存失败事实并交由 Worker 重试。
   */
  async synchronizeSource(sourceId: string): Promise<void> {
    this.requireConfigured(true)
    const source = await this.dependencies.repository.findSourceDocument(sourceId)
    if (!source) return
    const previous = (await this.dependencies.repository.listSyncRecords()).find(record => record.sourceId === sourceId)
    const timestamp = this.dependencies.clock.now()
    const pending: ContextSyncRecordView = {
      id: previous?.id ?? this.dependencies.identifiers.create(),
      sourceId,
      provider: 'openviking',
      remoteUri: previous?.remoteUri ?? null,
      contentHash: source.contentHash,
      status: 'pending',
      error: null,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await this.dependencies.repository.saveSyncRecord(pending)
    try {
      const remoteUri = await this.dependencies.openViking.synchronizeSource(source)
      await this.dependencies.repository.saveSyncRecord({
        ...pending,
        remoteUri,
        status: 'synchronized',
        updatedAt: this.dependencies.clock.now(),
      })
    }
    catch (error: unknown) {
      const message = safeProviderMessage(error)
      await this.dependencies.repository.saveSyncRecord({
        ...pending,
        status: 'failed',
        error: message,
        updatedAt: this.dependencies.clock.now(),
      })
      throw new TaskExecutionError(message, true)
    }
  }

  /**
   * 删除人样专属 OpenViking 根并从 SQLite 完整资料逐项重建。
   * @returns 每项资料成功或失败的持久同步结果。
   */
  async reindex(): Promise<ContextReindexResult> {
    this.requireConfigured(true)
    try {
      await this.dependencies.openViking.checkHealth()
      await this.dependencies.openViking.resetIndex()
    }
    catch (error: unknown) {
      throw toApplicationError(error)
    }

    const [sources, previousRecords] = await Promise.all([
      this.dependencies.repository.listSourceDocuments(),
      this.dependencies.repository.listSyncRecords(),
    ])
    const previousBySource = new Map(previousRecords.map(record => [record.sourceId, record]))
    let synchronized = 0
    for (const source of sources) {
      const previous = previousBySource.get(source.id)
      const timestamp = this.dependencies.clock.now()
      const pending: ContextSyncRecordView = {
        id: previous?.id ?? this.dependencies.identifiers.create(),
        sourceId: source.id,
        provider: 'openviking',
        remoteUri: previous?.remoteUri ?? null,
        contentHash: source.contentHash,
        status: 'pending',
        error: null,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      await this.dependencies.repository.saveSyncRecord(pending)
      try {
        const remoteUri = await this.dependencies.openViking.synchronizeSource(source)
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          remoteUri,
          status: 'synchronized',
          updatedAt: this.dependencies.clock.now(),
        })
        synchronized += 1
      }
      catch (error: unknown) {
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          status: 'failed',
          error: safeProviderMessage(error),
          updatedAt: this.dependencies.clock.now(),
        })
      }
    }
    const records = await this.dependencies.repository.listSyncRecords()
    return {
      provider: 'openviking',
      total: sources.length,
      synchronized,
      failed: sources.length - synchronized,
      records,
    }
  }

  /** @param requireEnabled 是否同时要求能力开关打开。 @returns 无返回值。 */
  private requireConfigured(requireEnabled: boolean): void {
    const capability = this.dependencies.openViking.getCapability()
    if (!capability.configured) throw new ApplicationError('CAPABILITY_DISABLED', 'OpenViking 服务地址尚未配置', 422)
    if (requireEnabled && !capability.enabled) {
      throw new ApplicationError('CAPABILITY_DISABLED', 'OpenViking 当前未启用，不能重建其索引', 422)
    }
  }
}

/** @param error 未知外部异常。 @returns 稳定应用错误。 */
function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof OpenVikingError) {
    return new ApplicationError(error.code, error.message, error.code === 'CAPABILITY_DISABLED' ? 422 : 503)
  }
  return new ApplicationError('PROVIDER_UNAVAILABLE', 'OpenViking 当前不可用', 503)
}

/** @param error 未知外部异常。 @returns 最长 500 字且不含原始响应的错误摘要。 */
function safeProviderMessage(error: unknown): string {
  if (error instanceof OpenVikingError) return error.message.slice(0, 500)
  return 'OpenViking 资料同步失败'
}

/** @param payloadJson 持久任务 JSON。 @returns 非空资料 UUID。 */
function readSourceId(payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as { sourceId?: unknown }
    if (typeof payload.sourceId === 'string' && payload.sourceId.trim()) return payload.sourceId
  }
  catch {
    // 统一在下方转为不可重试的安全任务错误。
  }
  throw new TaskExecutionError('OpenViking 同步任务缺少有效资料标识', false)
}
