import { createHash } from 'node:crypto'
import type { Clock } from '../../ports/Clock'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { NewPublicApiAuditRecord, PublicApiJsonValue, PublicApiRepository } from '../../ports/PublicApiRepository'
import { ApplicationError } from '../errors/ApplicationError'

/** 幂等动作输入。 */
export interface ExecuteIdempotentInput<TData extends PublicApiJsonValue> {
  apiKeyId: string
  method: string
  path: string
  idempotencyKey: string
  payload: unknown
  action: () => Promise<TData>
}

/** 公共写操作审计输入；标识和时间由应用服务生成。 */
export type RecordPublicApiAuditInput = Omit<NewPublicApiAuditRecord, 'id' | 'createdAt'>

/** 公共 API 应用服务依赖。 */
export interface PublicApiApplicationServiceDependencies {
  repository: PublicApiRepository
  identifiers: IdentifierGenerator
  clock: Clock
}

/** 编排公共 API 持久幂等和脱敏审计。 */
export class PublicApiApplicationService {
  /** @param dependencies 公共 API 仓储、标识和时间。 */
  constructor(private readonly dependencies: PublicApiApplicationServiceDependencies) {}

  /**
   * 执行一次持久幂等写操作并永久保存首次成功结果。
   * @param input Key、路由、幂等键、已校验载荷和业务动作。
   * @returns 首次或复用的 JSON 结果及复用标记。
   */
  async executeIdempotent<TData extends PublicApiJsonValue>(
    input: ExecuteIdempotentInput<TData>,
  ): Promise<{ data: TData, replayed: boolean }> {
    const method = input.method.toUpperCase()
    const requestHash = hashCanonicalJson(input.payload)
    const existing = await this.dependencies.repository.findIdempotency(
      input.apiKeyId, method, input.path, input.idempotencyKey,
    )
    if (existing) return this.replay<TData>(existing.requestHash, requestHash, existing.response)

    const timestamp = this.dependencies.clock.now()
    const id = this.dependencies.identifiers.create()
    const reserved = await this.dependencies.repository.reserveIdempotency({
      id,
      apiKeyId: input.apiKeyId,
      method,
      path: input.path,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      response: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    if (!reserved) {
      const concurrent = await this.dependencies.repository.findIdempotency(
        input.apiKeyId, method, input.path, input.idempotencyKey,
      )
      if (!concurrent) throw new ApplicationError('IDEMPOTENCY_CONFLICT', '幂等请求状态冲突', 409)
      return this.replay<TData>(concurrent.requestHash, requestHash, concurrent.response)
    }

    try {
      const data = await input.action()
      await this.dependencies.repository.completeIdempotency(id, data, this.dependencies.clock.now())
      return { data, replayed: false }
    }
    catch (error: unknown) {
      await this.dependencies.repository.releaseIdempotency(id)
      throw error
    }
  }

  /** @param input 已脱敏写操作结果。 @returns 审计写入完成时结束。 */
  async recordAudit(input: RecordPublicApiAuditInput): Promise<void> {
    await this.dependencies.repository.appendAudit({
      ...input,
      id: this.dependencies.identifiers.create(),
      createdAt: this.dependencies.clock.now(),
    })
  }

  /** @param storedHash 首次载荷摘要。 @param requestHash 本次载荷摘要。 @param response 已完成结果或 null。 @returns 可复用结果。 */
  private replay<TData extends PublicApiJsonValue>(
    storedHash: string,
    requestHash: string,
    response: PublicApiJsonValue | null,
  ): { data: TData, replayed: true } {
    if (storedHash !== requestHash) {
      throw new ApplicationError('IDEMPOTENCY_CONFLICT', '相同幂等键已用于不同请求内容', 409)
    }
    if (response === null) {
      throw new ApplicationError('IDEMPOTENCY_IN_PROGRESS', '相同幂等请求正在处理', 409)
    }
    return { data: response as TData, replayed: true }
  }
}

/** @param value 未知已校验载荷。 @returns 与对象字段顺序无关的 SHA-256 摘要。 */
function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

/** @param value 未知值。 @returns 键顺序稳定且只含 JSON 值的副本。 */
function canonicalize(value: unknown): PublicApiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ApplicationError('VALIDATION_FAILED', '请求包含无效数字', 422)
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  throw new ApplicationError('VALIDATION_FAILED', '请求包含不能序列化的值', 422)
}
