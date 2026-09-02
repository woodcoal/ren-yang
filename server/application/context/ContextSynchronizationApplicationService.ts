import { updateOpenVikingSettingsSchema, type UpdateOpenVikingSettingsInput } from '../../../shared/schemas/context'
import type { ContextReindexResult, ContextSyncRecordPageView, ContextSyncRecordView, OpenVikingSettingsView } from '../../../shared/types/context'
import type { Clock } from '../../ports/Clock'
import type { ContextIndexRepository, ListSyncRecordPageInput } from '../../ports/ContextIndexRepository'
import type { ContextProjectionEntityType, ContextSourceProjection } from '../../ports/ContextIndexRepository'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { OpenVikingPort } from '../../ports/OpenVikingPort'
import { OpenVikingError } from '../../ports/OpenVikingPort'
import type { OpenVikingSettingsRepository } from '../../ports/OpenVikingSettingsRepository'
import type { SecretCipher } from '../../ports/SecretCipher'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import { ApplicationError } from '../errors/ApplicationError'
import {
  calculateOpenVikingRetryDelay,
  isOpenVikingDirectoryDeleteModeError,
  isOpenVikingInputLimitError,
} from '../../domain/context/OpenVikingRetryPolicy'

/** OpenViking ADMIN Key 与其他凭据隔离的加密上下文。 */
export const OPEN_VIKING_SECRET_CONTEXT = 'openviking:administrator-api-key'

/** 上下文索引同步应用服务依赖。 */
export interface ContextSynchronizationApplicationServiceDependencies {
  /** SQLite 资料与同步事实源。 */
  repository: ContextIndexRepository
  /** OpenViking 外部能力端口。 */
  openViking: OpenVikingPort
  /** OpenViking 加密设置事实源。 */
  settings?: OpenVikingSettingsRepository
  /** ADMIN Key 加解密端口。 */
  secretCipher?: SecretCipher
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

  /** @returns 当前不含 ADMIN Key 密文的后台设置。 */
  async getSettings(): Promise<OpenVikingSettingsView> {
    const current = await this.dependencies.settings?.find() ?? null
    if (!current) return { enabled: false, endpoint: '', accountId: 'ren-yang', hasApiKey: false, timeoutMs: 60_000, updatedAt: null }
    const { apiKeyCiphertext: _apiKeyCiphertext, ...view } = current
    return view
  }

  /**
   * 加密保存 OpenViking 设置，并在启用时补排 SQLite 当前事实。
   * @param input 管理员提交的完整非敏感字段与可选新 ADMIN Key。
   * @returns 保存后的脱敏设置。
   */
  async updateSettings(input: UpdateOpenVikingSettingsInput): Promise<OpenVikingSettingsView> {
    const normalized = updateOpenVikingSettingsSchema.parse(input)
    const settings = this.dependencies.settings
    const secretCipher = this.dependencies.secretCipher
    if (!settings || !secretCipher) throw new ApplicationError('CAPABILITY_DISABLED', 'OpenViking 设置存储尚未配置', 503)
    const current = await settings.find()
    const apiKeyCiphertext = normalized.apiKey
      ? secretCipher.encrypt(normalized.apiKey, OPEN_VIKING_SECRET_CONTEXT)
      : current?.apiKeyCiphertext ?? ''
    if (normalized.enabled && !apiKeyCiphertext) {
      throw new ApplicationError('VALIDATION_FAILED', '启用 OpenViking 前必须填写 ADMIN Key', 422)
    }
    const saved = await settings.save({
      enabled: normalized.enabled,
      endpoint: normalized.endpoint,
      accountId: normalized.accountId,
      apiKeyCiphertext,
      timeoutMs: normalized.timeoutMs,
      timestamp: this.dependencies.clock.now(),
    })
    if (current && current.accountId !== saved.accountId) {
      const timestamp = this.dependencies.clock.now()
      await this.dependencies.repository.markSourceProjectionsForRebuild(timestamp)
      await this.dependencies.repository.markSessionsForRebuild(timestamp)
    }
    if (saved.enabled) await this.recoverPendingTasks()
    return saved
  }

  /** @returns 当前全部资料同步事实。 */
  async listSyncRecords(): Promise<ContextSyncRecordView[]> {
    return await this.dependencies.repository.listSyncRecords()
  }

  /** @param input 分页参数。 @returns 当前同步日志分页结果。 */
  async listSyncRecordsPage(input: ListSyncRecordPageInput): Promise<ContextSyncRecordPageView> {
    return await this.dependencies.repository.listSyncRecordsPage(input)
  }

  /** @returns 当前同步失败记录数。 */
  async countFailedSyncRecords(): Promise<number> {
    return await this.dependencies.repository.countFailedSyncRecords()
  }

  /** @returns 当前失败分类、自动重试数量和全局降级状态。 */
  async getSyncSummary() {
    return await this.dependencies.repository.getSyncSummary()
  }

  /** @returns 主动联网检测结果；不修改索引或开关。 */
  async checkProvider() {
    this.requireConfigured(false)
    try {
      const health = await this.dependencies.openViking.checkHealth()
      await this.dependencies.repository.markSyncHealthy(this.dependencies.clock.now())
      return health
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
    const timestamp = this.dependencies.clock.now()
    const [projections, records, sessions, storedRuntime] = await Promise.all([
      this.dependencies.repository.listSourceProjections(),
      this.dependencies.repository.listSyncRecords(),
      this.dependencies.repository.listPendingSessionSources(),
      this.dependencies.repository.getSyncRuntime(),
    ])
    // 旧版本曾把单项输入限制或资料目录删除参数错误持久化为全局人工降级；升级后启动时直接修复该错误状态。
    const runtime = storedRuntime.state === 'degraded'
      && storedRuntime.retryAfter === null
      && storedRuntime.lastError !== null
      && (
        isOpenVikingInputLimitError(storedRuntime.lastError)
        || isOpenVikingDirectoryDeleteModeError(storedRuntime.lastError)
      )
      ? await this.dependencies.repository.markSyncHealthy(timestamp)
      : storedRuntime
    // 达到人工处理状态后禁止应用重启再次制造任务；管理员重试会把 retryAfter 改为当前时间。
    if (runtime.state !== 'degraded' || runtime.retryAfter !== null) {
      await queue.enqueueUserReconciliation(this.dependencies.identifiers.create(), timestamp)
    }
    const desiredByKey = new Map(projections.map(projection => [projectionKey(projection), projection]))
    const recordsByKey = new Map(records.map(record => [recordKey(record), record]))
    const entities = new Map<string, { entityType: ContextProjectionEntityType, sourceId: string, notBefore: number }>()
    for (const [key, projection] of desiredByKey) {
      const record = recordsByKey.get(key)
      const definitionChanged = Boolean(record) && (
        record!.contentHash !== projection.source.contentHash
        || record!.operation !== projection.operation
        || projectionIdentityChanged(record!, projection)
      )
      const requiresSync = !record || record.status !== 'synchronized' || definitionChanged
      const needsAttention = record?.status === 'failed' && record.nextRetryAt === null && !definitionChanged
      if (requiresSync && !needsAttention) {
        entities.set(`${projection.source.entityType}:${projection.source.id}`, {
          entityType: projection.source.entityType,
          sourceId: projection.source.id,
          notBefore: definitionChanged ? timestamp : record?.nextRetryAt ?? timestamp,
        })
      }
    }
    for (const record of records) {
      if (!desiredByKey.has(recordKey(record)) && ['source_material', 'persona_feedback_source'].includes(record.entityType)) {
        if (record.status === 'failed' && record.nextRetryAt === null) continue
        entities.set(`${record.entityType}:${record.sourceId}`, {
          entityType: record.entityType as ContextProjectionEntityType,
          sourceId: record.sourceId,
          notBefore: record.nextRetryAt ?? timestamp,
        })
      }
    }
    for (const entity of entities.values()) {
      await queue.enqueueSourceSynchronization(
        entity.sourceId,
        this.dependencies.identifiers.create(),
        this.dependencies.clock.now(),
        entity.entityType,
        entity.notBefore,
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
    if (!this.dependencies.openViking.getCapability().enabled) return
    try {
      await this.dependencies.openViking.checkWriteHealth()
      // 队列接口当前可达即可解除历史累计错误造成的旧降级；后续服务级失败会在 catch 中重新降级。
      await this.dependencies.repository.markSyncHealthy(this.dependencies.clock.now())
      if (job.type === 'sync_openviking_users') {
        await this.reconcileUsers()
      }
      else if (job.type === 'sync_context_source') {
        const entity = readProjectionSource(job.payloadJson)
        await this.synchronizeProjectionEntity(entity.entityType, entity.sourceId, job)
      }
      else if (job.type === 'sync_openviking_session') {
        const payload = readSessionSource(job.payloadJson)
        await this.synchronizeSession(payload.sourceType, payload.sourceId)
      }
      else {
        throw new TaskExecutionError(`上下文同步服务未注册任务类型：${job.type}`, false)
      }
    }
    catch (error: unknown) {
      const normalized = normalizeTaskError(error)
      if (normalized.retryable) {
        const timestamp = this.dependencies.clock.now()
        const retryAfter = job.attemptCount < job.maxAttempts
          ? timestamp + calculateOpenVikingRetryDelay(job.attemptCount)
          : null
        await this.dependencies.repository.markSyncDegraded(normalized.message, retryAfter, timestamp)
      }
      throw normalized
    }
  }

  /** @returns 按 SQLite 当前世界对账 OpenViking User，并清理旧独立人物 User 后结束。 */
  async reconcileUsers(): Promise<void> {
    this.requireConfigured(true)
    try {
      const userIds = await this.dependencies.repository.listTargetUserIds()
      await this.dependencies.openViking.reconcileUsers(userIds)
    }
    catch (error: unknown) {
      throw new TaskExecutionError(safeProviderMessage(error), true)
    }
  }

  /**
   * 读取 SQLite 最新资料并同步单个稳定远端 URI；资料已删除时同步清理远端资源。
   * @param sourceId 资料 UUID。
   * @returns 同步完成时结束；外部故障保存失败事实并交由 Worker 重试。
   */
  async synchronizeSource(sourceId: string): Promise<void> {
    await this.synchronizeProjectionEntity('source_material', sourceId)
  }

  /** @param entityType 普通资料或人物反馈资料。 @param sourceId SQLite 实体 UUID。 @returns 当前投影意图执行完成时结束。 */
  async synchronizeProjectionEntity(entityType: ContextProjectionEntityType, sourceId: string, job?: TaskJob): Promise<void> {
    this.requireConfigured(true)
    const [projections, allRecords] = await Promise.all([
      this.dependencies.repository.listSourceProjections(entityType, sourceId),
      this.dependencies.repository.listSyncRecords(),
    ])
    const records = allRecords.filter(record => record.entityType === entityType && record.sourceId === sourceId)
    const desiredKeys = new Set(projections.map(projectionKey))
    let failedMessage: string | null = null
    let hasRetryableFailure = false
    for (const record of records.filter(item => !desiredKeys.has(recordKey(item)))) {
      try {
        await this.dependencies.openViking.deleteProjection(record)
        await this.dependencies.repository.deleteSyncRecord(record.id)
      }
      catch (error: unknown) {
        const failure = toProjectionFailure(error, record.failureCount, this.dependencies.clock.now(), job)
        failedMessage = failure.error
        hasRetryableFailure ||= failure.retryable
        await this.dependencies.repository.saveSyncRecord({
          ...record,
          status: 'failed',
          error: failure.error,
          errorCode: failure.errorCode,
          errorStage: failure.errorStage,
          failureCount: failure.failureCount,
          nextRetryAt: failure.nextRetryAt,
          updatedAt: failure.timestamp,
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
          const failure = toProjectionFailure(error, previous.failureCount, this.dependencies.clock.now(), job)
          failedMessage = failure.error
          hasRetryableFailure ||= failure.retryable
          await this.dependencies.repository.saveSyncRecord({
            ...previous,
            status: 'failed',
            error: failure.error,
            errorCode: failure.errorCode,
            errorStage: failure.errorStage,
            failureCount: failure.failureCount,
            nextRetryAt: failure.nextRetryAt,
            updatedAt: failure.timestamp,
          })
          // 保留旧身份和 URI，供 Worker 重试删除；不能先覆盖成新世界身份，否则旧投影将无法定位。
          continue
        }
      }
      const timestamp = this.dependencies.clock.now()
      const pending = toPendingRecord(projection, previous, this.dependencies.identifiers.create(), timestamp)
      await this.dependencies.repository.saveSyncRecord(pending)
      try {
        if (projection.operation === 'delete') {
          await this.dependencies.openViking.deleteProjection(pending)
          await this.dependencies.repository.deleteSyncRecord(pending.id)
          if (projection.source.entityType === 'persona_feedback_source') {
            await this.dependencies.repository.finalizePersonaFeedbackSourceDeletion(projection.source.id, this.dependencies.clock.now())
          }
          continue
        }
        const remoteUri = await this.dependencies.openViking.synchronizeProjection(projection)
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          remoteUri,
          status: 'synchronized',
          error: null,
          errorCode: null,
          errorStage: null,
          failureCount: 0,
          nextRetryAt: null,
          updatedAt: this.dependencies.clock.now(),
        })
      }
      catch (error: unknown) {
        const failure = toProjectionFailure(error, pending.failureCount, this.dependencies.clock.now(), job)
        failedMessage = failure.error
        hasRetryableFailure ||= failure.retryable
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          status: 'failed',
          error: failure.error,
          errorCode: failure.errorCode,
          errorStage: failure.errorStage,
          failureCount: failure.failureCount,
          nextRetryAt: failure.nextRetryAt,
          updatedAt: failure.timestamp,
        })
      }
    }
    if (failedMessage) throw new TaskExecutionError(failedMessage, hasRetryableFailure)
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
   * 清空人样专属 OpenViking 投影，并从 SQLite 完整资料逐项重建。
   * @returns 每项资料成功或失败的持久同步结果。
   */
  async reindex(): Promise<ContextReindexResult> {
    this.requireConfigured(true)
    const targetUserIds = await this.dependencies.repository.listTargetUserIds()
    const preflightTimestamp = this.dependencies.clock.now()
    await this.dependencies.repository.allowImmediateSyncRetry(preflightTimestamp)
    try {
      await this.dependencies.openViking.checkWriteHealth(true)
      await this.dependencies.openViking.resetLegacyIndex()
      await this.dependencies.openViking.rebuildUsers(targetUserIds)
      await this.dependencies.repository.markSessionsForRebuild(this.dependencies.clock.now())
    }
    catch (error: unknown) {
      const message = safeProviderMessage(error)
      await this.dependencies.repository.markSyncDegraded(
        message,
        preflightTimestamp + calculateOpenVikingRetryDelay(1),
        preflightTimestamp,
      )
      throw toApplicationError(error)
    }

    const [projections, previousRecords] = await Promise.all([
      this.dependencies.repository.listSourceProjections(),
      this.dependencies.repository.listSyncRecords(),
    ])
    // 远端受管根目录和孤立 User 已成功清空，不再逐条重复删除旧 URI，避免再次等待语义刷新。
    // 保留 previousRecords 仅用于复用同步记录 ID 和创建时间，便于历史审计保持连续。
    for (const record of previousRecords) {
      await this.dependencies.repository.deleteSyncRecord(record.id)
    }
    const previousByProjection = new Map(previousRecords.map(record => [recordKey(record), record]))
    let synchronized = 0
    for (const projection of projections) {
      const previous = previousByProjection.get(projectionKey(projection))
      const timestamp = this.dependencies.clock.now()
      const pending = toPendingRecord(projection, previous, this.dependencies.identifiers.create(), timestamp)
      await this.dependencies.repository.saveSyncRecord(pending)
      try {
        if (projection.operation === 'delete') {
          await this.dependencies.openViking.deleteProjection(pending)
          await this.dependencies.repository.deleteSyncRecord(pending.id)
          if (projection.source.entityType === 'persona_feedback_source') {
            await this.dependencies.repository.finalizePersonaFeedbackSourceDeletion(projection.source.id, this.dependencies.clock.now())
          }
          synchronized += 1
          continue
        }
        const remoteUri = await this.dependencies.openViking.synchronizeProjection(projection)
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          remoteUri,
          status: 'synchronized',
          error: null,
          errorCode: null,
          errorStage: null,
          failureCount: 0,
          nextRetryAt: null,
          updatedAt: this.dependencies.clock.now(),
        })
        synchronized += 1
      }
      catch (error: unknown) {
        const failure = toProjectionFailure(error, pending.failureCount, this.dependencies.clock.now())
        await this.dependencies.repository.saveSyncRecord({
          ...pending,
          status: 'failed',
          error: failure.error,
          errorCode: failure.errorCode,
          errorStage: failure.errorStage,
          failureCount: failure.failureCount,
          nextRetryAt: failure.nextRetryAt,
          updatedAt: failure.timestamp,
        })
      }
    }
    const records = await this.dependencies.repository.listSyncRecords()
    await this.dependencies.openViking.reconcileUsers(targetUserIds)
    if (this.dependencies.taskQueue) {
      const sessions = await this.dependencies.repository.listPendingSessionSources()
      for (const session of sessions) {
        await this.dependencies.taskQueue.enqueueSessionSynchronization(
          session.sourceType,
          session.sourceId,
          this.dependencies.identifiers.create(),
          this.dependencies.clock.now(),
        )
      }
    }
    if (synchronized === projections.length) {
      await this.dependencies.repository.markSyncHealthy(this.dependencies.clock.now())
    }
    else {
      const nextRetryAt = records
        .filter(record => record.status === 'failed' && record.nextRetryAt !== null)
        .reduce<number | null>((earliest, record) => earliest === null ? record.nextRetryAt : Math.min(earliest, record.nextRetryAt!), null)
      await this.dependencies.repository.markSyncDegraded(
        records.find(record => record.status === 'failed')?.error ?? 'OpenViking 全量重建存在失败投影',
        nextRetryAt,
        this.dependencies.clock.now(),
      )
      await this.recoverPendingTasks()
    }
    return {
      provider: 'openviking',
      total: projections.length,
      synchronized,
      failed: projections.length - synchronized,
      records,
    }
  }

  /**
   * 由管理员重新安排全部失败投影，或指定资料实体的失败投影。
   * @param target 可选资料实体；省略时处理全部失败投影。
   * @returns 实际重新排队的资料实体数量。
   */
  async retryFailedSync(target?: { entityType: ContextProjectionEntityType, sourceId: string }): Promise<{ enqueued: number }> {
    this.requireConfigured(true)
    const timestamp = this.dependencies.clock.now()
    const queue = this.dependencies.taskQueue
    if (!queue) throw new ApplicationError('CAPABILITY_DISABLED', 'OpenViking 同步任务队列尚未配置', 503)
    const records = (await this.dependencies.repository.listSyncRecords()).filter(record => {
      if (record.status !== 'failed') return false
      return !target || (record.entityType === target.entityType && record.sourceId === target.sourceId)
    })
    const entities = new Map<string, { entityType: ContextProjectionEntityType, sourceId: string }>()
    for (const record of records) {
      const entityType = record.entityType as ContextProjectionEntityType
      entities.set(`${entityType}:${record.sourceId}`, { entityType, sourceId: record.sourceId })
      await this.dependencies.repository.saveSyncRecord({
        ...record,
        failureCount: 0,
        nextRetryAt: timestamp,
        updatedAt: timestamp,
      })
    }
    await this.dependencies.repository.allowImmediateSyncRetry(timestamp)
    for (const entity of entities.values()) {
      await queue.enqueueSourceSynchronization(
        entity.sourceId,
        this.dependencies.identifiers.create(),
        timestamp,
        entity.entityType,
        timestamp,
      )
    }
    return { enqueued: entities.size }
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
  return `${projection.source.entityType}:${projection.source.id}:${projection.scopeType}:${projection.scopeId}`
}

/** @param record 已保存同步记录。 @returns 稳定投影键。 */
function recordKey(record: ContextSyncRecordView): string {
  return `${record.entityType}:${record.sourceId}:${record.scopeType}:${record.scopeId}`
}

/**
 * 判断同一业务投影是否已经迁移到另一个 OpenViking 身份空间或远端路径。
 * @param record SQLite 保存的旧投影身份。
 * @param projection SQLite 当前应有投影身份。
 * @returns User、Peer 或 URI 任一变化时返回 true。
 */
function projectionIdentityChanged(record: ContextSyncRecordView, projection: ContextSourceProjection): boolean {
  return record.userId !== projection.userId || record.peerId !== projection.peerId || record.remoteUri !== projection.remoteUri
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
    entityType: projection.source.entityType,
    sourceId: projection.source.id,
    scopeType: projection.scopeType,
    scopeId: projection.scopeId,
    userId: projection.userId,
    peerId: projection.peerId,
    provider: 'openviking',
    remoteUri: projection.remoteUri,
    contentHash: projection.source.contentHash,
    status: 'pending',
    operation: projection.operation,
    error: null,
    errorCode: null,
    errorStage: null,
    failureCount: previous?.failureCount ?? 0,
    nextRetryAt: null,
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

/** 单项投影失败后允许持久化的恢复信息。 */
interface ProjectionFailure {
  /** 脱敏错误摘要。 */
  error: string
  /** OpenViking 稳定错误代码。 */
  errorCode: string | null
  /** 不含路径参数的请求阶段。 */
  errorStage: string | null
  /** 是否适合自动重试。 */
  retryable: boolean
  /** 当前连续失败次数。 */
  failureCount: number
  /** 下次自动重试时间；为空表示需要人工处理。 */
  nextRetryAt: number | null
  /** 本次失败时间。 */
  timestamp: number
}

/**
 * 把外部异常转换为投影状态和持久退避时间。
 * @param error 未知外部异常。
 * @param previousFailureCount 该投影此前连续失败次数。
 * @param timestamp 当前 UTC Unix 毫秒。
 * @param job 可选当前任务尝试快照。
 * @returns 不含正文、URI和凭据的失败信息。
 */
function toProjectionFailure(
  error: unknown,
  previousFailureCount: number,
  timestamp: number,
  job?: TaskJob,
): ProjectionFailure {
  const providerError = error instanceof OpenVikingError ? error : null
  const retryable = providerError?.retryable ?? true
  const failureCount = previousFailureCount + 1
  const attemptsRemain = !job || job.attemptCount < job.maxAttempts
  return {
    error: safeProviderMessage(error),
    errorCode: providerError?.details.providerCode ?? null,
    errorStage: providerError?.details.operation ?? null,
    retryable,
    failureCount,
    nextRetryAt: retryable && attemptsRemain
      ? timestamp + calculateOpenVikingRetryDelay(job?.attemptCount ?? failureCount)
      : null,
    timestamp,
  }
}

/** @param error 未知任务异常。 @returns 保留明确重试语义的安全任务错误。 */
function normalizeTaskError(error: unknown): TaskExecutionError {
  if (error instanceof TaskExecutionError) return error
  if (error instanceof OpenVikingError) return new TaskExecutionError(error.message.slice(0, 500), error.retryable)
  return new TaskExecutionError('OpenViking 同步任务执行失败', true)
}

/** @param payloadJson 持久任务 JSON。 @returns 已校验投影实体类型和 UUID。 */
function readProjectionSource(payloadJson: string): { entityType: ContextProjectionEntityType, sourceId: string } {
  try {
    const payload = JSON.parse(payloadJson) as { entityType?: unknown, sourceId?: unknown }
    const entityType = payload.entityType ?? 'source_material'
    if ((entityType === 'source_material' || entityType === 'persona_feedback_source')
      && typeof payload.sourceId === 'string' && payload.sourceId.trim()) {
      return { entityType, sourceId: payload.sourceId }
    }
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
