import type { ContextReindexResult, ContextSyncRecordView } from '../../../shared/types/context'
import type { Clock } from '../../ports/Clock'
import type { ContextIndexRepository } from '../../ports/ContextIndexRepository'
import type { ContextSourceProjection } from '../../ports/ContextIndexRepository'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
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
  /** OpenViking 启用时用于启动补偿的持久任务队列。 */
  taskQueue?: ContextSyncTaskQueue
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
   * 从 SQLite 当前事实补回进程退出窗口中可能缺失的资料与 Session 任务。
   * @returns 新任务检查和幂等入队完成时结束；能力关闭时直接结束。
   */
  async recoverPendingTasks(): Promise<void> {
    const queue = this.dependencies.taskQueue
    const capability = this.dependencies.openViking.getCapability()
    if (!queue || !capability.enabled) return
    const [projections, records, sessions] = await Promise.all([
      this.dependencies.repository.listSourceProjections(),
      this.dependencies.repository.listSyncRecords(),
      this.dependencies.repository.listPendingSessionSources(),
    ])
    const desiredByKey = new Map(projections.map(projection => [projectionKey(projection), projection]))
    const recordsByKey = new Map(records.map(record => [recordKey(record), record]))
    const sourceIds = new Set<string>()
    for (const [key, projection] of desiredByKey) {
      const record = recordsByKey.get(key)
      if (!record
        || record.status !== 'synchronized'
        || record.contentHash !== projection.source.contentHash
        || projectionIdentityChanged(record, projection)) {
        sourceIds.add(projection.source.id)
      }
    }
    for (const record of records) {
      if (!desiredByKey.has(recordKey(record))) sourceIds.add(record.sourceId)
    }
    for (const sourceId of sourceIds) {
      await queue.enqueueSourceSynchronization(
        sourceId,
        this.dependencies.identifiers.create(),
        this.dependencies.clock.now(),
      )
    }
    for (const session of sessions) {
      await queue.enqueueSessionSynchronization(
        session.sourceType,
        session.sourceId,
        this.dependencies.identifiers.create(),
        this.dependencies.clock.now(),
      )
    }
  }

  /**
   * 执行 Worker 已领取的单资料同步任务。
   * @param job 类型为 sync_context_source 的持久任务。
   * @returns SQLite 当前资料写入远端并保存同步事实后结束。
   */
  async execute(job: TaskJob): Promise<void> {
    if (job.type === 'sync_context_source') {
      await this.synchronizeSource(readSourceId(job.payloadJson))
      return
    }
    if (job.type === 'sync_openviking_session') {
      const payload = readSessionSource(job.payloadJson)
      await this.synchronizeSession(payload.sourceType, payload.sourceId)
      return
    }
    throw new Error(`上下文同步服务未注册任务类型：${job.type}`)
  }

  /**
   * 读取 SQLite 最新资料并同步单个稳定远端 URI；资料已删除时同步清理远端资源。
   * @param sourceId 资料 UUID。
   * @returns 同步完成时结束；外部故障保存失败事实并交由 Worker 重试。
   */
  async synchronizeSource(sourceId: string): Promise<void> {
    this.requireConfigured(true)
    const [projections, allRecords] = await Promise.all([
      this.dependencies.repository.listSourceProjections(sourceId),
      this.dependencies.repository.listSyncRecords(),
    ])
    const records = allRecords.filter(record => record.sourceId === sourceId)
    const desiredKeys = new Set(projections.map(projectionKey))
    let failedMessage: string | null = null
    for (const record of records.filter(item => !desiredKeys.has(recordKey(item)))) {
      try {
        await this.dependencies.openViking.deleteProjection(record)
        await this.dependencies.repository.deleteSyncRecord(record.id)
      }
      catch (error: unknown) {
        failedMessage = error instanceof OpenVikingError ? error.message.slice(0, 500) : 'OpenViking 远端资料删除失败'
        await this.dependencies.repository.saveSyncRecord({
          ...record,
          status: 'failed',
          error: failedMessage,
          updatedAt: this.dependencies.clock.now(),
        })
      }
    }
    for (const projection of projections) {
      let previous = records.find(record => recordKey(record) === projectionKey(projection))
      if (previous && projectionIdentityChanged(previous, projection)) {
        try {
          // 人物换世界后字面 URI 不变，但 URI 会在新的 User 下解析；必须先用旧身份删除旧投影。
          await this.dependencies.openViking.deleteProjection(previous)
          await this.dependencies.repository.deleteSyncRecord(previous.id)
          previous = undefined
        }
        catch (error: unknown) {
          failedMessage = safeProviderMessage(error)
          await this.dependencies.repository.saveSyncRecord({
            ...previous,
            status: 'failed',
            error: failedMessage,
            updatedAt: this.dependencies.clock.now(),
          })
          // 保留旧身份和 URI，供 Worker 重试删除；不能先覆盖成新世界身份，否则旧投影将无法定位。
          continue
        }
      }
      const timestamp = this.dependencies.clock.now()
      const pending = toPendingRecord(projection, previous, this.dependencies.identifiers.create(), timestamp)
      await this.dependencies.repository.saveSyncRecord(pending)
      try {
        const remoteUri = await this.dependencies.openViking.synchronizeProjection(projection)
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          remoteUri,
          status: 'synchronized',
          updatedAt: this.dependencies.clock.now(),
        })
      }
      catch (error: unknown) {
        failedMessage = safeProviderMessage(error)
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          status: 'failed',
          error: failedMessage,
          updatedAt: this.dependencies.clock.now(),
        })
      }
    }
    if (failedMessage) throw new TaskExecutionError(failedMessage, true)
  }

  /** @param sourceType 生成运行或反馈。 @param sourceId 本地事实 UUID。 @returns 远端 Session 与候选记忆同步完成时结束。 */
  async synchronizeSession(sourceType: 'run' | 'feedback', sourceId: string): Promise<void> {
    this.requireConfigured(true)
    const exchange = await this.dependencies.repository.findSessionExchange(sourceType, sourceId)
    if (!exchange) return
    await this.dependencies.repository.saveSessionState(exchange, 'pending', null, this.dependencies.clock.now())
    try {
      const memories = await this.dependencies.openViking.synchronizeSession(exchange)
      await this.dependencies.repository.saveSessionResult(exchange, memories, this.dependencies.clock.now())
    }
    catch (error: unknown) {
      const message = safeProviderMessage(error)
      await this.dependencies.repository.saveSessionState(exchange, 'failed', message, this.dependencies.clock.now())
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
      await this.dependencies.openViking.resetLegacyIndex()
    }
    catch (error: unknown) {
      throw toApplicationError(error)
    }

    const [projections, previousRecords] = await Promise.all([
      this.dependencies.repository.listSourceProjections(),
      this.dependencies.repository.listSyncRecords(),
    ])
    const desiredKeys = new Set(projections.map(projectionKey))
    const blockedKeys = new Set<string>()
    let orphanCleanupFailures = 0
    for (const record of previousRecords) {
      try {
        await this.dependencies.openViking.deleteProjection(record)
        await this.dependencies.repository.deleteSyncRecord(record.id)
      }
      catch (error: unknown) {
        const key = recordKey(record)
        await this.dependencies.repository.saveSyncRecord({
          ...record,
          status: 'failed',
          error: safeProviderMessage(error),
          updatedAt: this.dependencies.clock.now(),
        })
        if (desiredKeys.has(key)) blockedKeys.add(key)
        else orphanCleanupFailures += 1
      }
    }
    const previousByProjection = new Map(previousRecords.map(record => [recordKey(record), record]))
    let synchronized = 0
    for (const projection of projections) {
      if (blockedKeys.has(projectionKey(projection))) {
        // 删除旧身份投影失败时保留原记录，避免用新身份覆盖后失去重试目标。
        continue
      }
      const previous = previousByProjection.get(projectionKey(projection))
      const timestamp = this.dependencies.clock.now()
      const pending = toPendingRecord(projection, previous, this.dependencies.identifiers.create(), timestamp)
      await this.dependencies.repository.saveSyncRecord(pending)
      try {
        const remoteUri = await this.dependencies.openViking.synchronizeProjection(projection)
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
      total: projections.length + orphanCleanupFailures,
      synchronized,
      failed: projections.length - synchronized + orphanCleanupFailures,
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

/** @param projection SQLite 当前投影。 @returns 稳定投影键。 */
function projectionKey(projection: ContextSourceProjection): string {
  return `${projection.source.id}:${projection.scopeType}:${projection.scopeId}`
}

/** @param record 已保存同步记录。 @returns 稳定投影键。 */
function recordKey(record: ContextSyncRecordView): string {
  return `${record.sourceId}:${record.scopeType}:${record.scopeId}`
}

/**
 * 判断同一业务投影是否已经迁移到另一个 OpenViking 身份空间。
 * @param record SQLite 保存的旧投影身份。
 * @param projection SQLite 当前应有投影身份。
 * @returns User 或 Peer 任一变化时返回 true。
 */
function projectionIdentityChanged(record: ContextSyncRecordView, projection: ContextSourceProjection): boolean {
  return record.userId !== projection.userId || record.peerId !== projection.peerId
}

/**
 * 生成一次待同步事实。
 * @param projection SQLite 当前投影。
 * @param previous 同一投影旧记录。
 * @param newId 没有旧记录时使用的新 UUID。
 * @param timestamp 当前时间。
 * @returns 可直接保存的 pending 记录。
 */
function toPendingRecord(
  projection: ContextSourceProjection,
  previous: ContextSyncRecordView | undefined,
  newId: string,
  timestamp: number,
): ContextSyncRecordView {
  return {
    id: previous?.id ?? newId,
    sourceId: projection.source.id,
    scopeType: projection.scopeType,
    scopeId: projection.scopeId,
    userId: projection.userId,
    peerId: projection.peerId,
    provider: 'openviking',
    remoteUri: previous?.remoteUri ?? null,
    contentHash: projection.source.contentHash,
    status: 'pending',
    error: null,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
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

/** @param payloadJson 持久任务 JSON。 @returns 有效 Session 本地来源。 */
function readSessionSource(payloadJson: string): { sourceType: 'run' | 'feedback', sourceId: string } {
  try {
    const payload = JSON.parse(payloadJson) as { sourceType?: unknown, sourceId?: unknown }
    if ((payload.sourceType === 'run' || payload.sourceType === 'feedback')
      && typeof payload.sourceId === 'string' && payload.sourceId.trim()) {
      return { sourceType: payload.sourceType, sourceId: payload.sourceId }
    }
  }
  catch {
    // 统一在下方转换为不可重试的安全任务错误。
  }
  throw new TaskExecutionError('OpenViking Session 同步任务缺少有效来源', false)
}
