import { createHash, randomBytes } from 'node:crypto'
import type { ApiKeyScope, CreateApiKeyInput } from '../../../shared/schemas/publicApi'
import type { ApiKeyPrincipal, ApiKeyView, CreatedApiKeyView } from '../../../shared/types/publicApi'
import type { ApiKeyRecord, ApiKeyRepository } from '../../ports/ApiKeyRepository'
import type { Clock } from '../../ports/Clock'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import { ApplicationError } from '../errors/ApplicationError'

/** API Key 服务依赖。 */
export interface ApiKeyApplicationServiceDependencies {
  repository: ApiKeyRepository
  identifiers: IdentifierGenerator
  clock: Clock
  /** 测试可替换的高熵明文生成器。 */
  generateSecret?: () => string
}

/** 管理 API Key 生命周期并完成公共请求认证。 */
export class ApiKeyApplicationService {
  /** @param dependencies API Key 仓储、标识、时间和可选明文生成器。 */
  constructor(private readonly dependencies: ApiKeyApplicationServiceDependencies) {}

  /**
   * 创建只保存摘要的新 API Key。
   * @param input 已校验的名称、权限和可选到期时间。
   * @returns 仅本次包含明文的创建结果。
   */
  async create(input: CreateApiKeyInput): Promise<CreatedApiKeyView> {
    const createdAt = this.dependencies.clock.now()
    const expiresAt = input.expiresAt === null ? null : Date.parse(input.expiresAt)
    if (expiresAt !== null && expiresAt <= createdAt) {
      throw new ApplicationError('API_KEY_EXPIRY_INVALID', 'API Key 到期时间必须晚于当前时间', 422)
    }
    const secret = this.dependencies.generateSecret?.() ?? generateApiKeySecret()
    const record: ApiKeyRecord = {
      id: this.dependencies.identifiers.create(),
      name: input.name,
      keyPrefix: secret.slice(0, 12),
      keyDigest: digestApiKey(secret),
      scopes: [...input.scopes],
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt,
    }
    await this.dependencies.repository.create(record)
    return { key: toView(record, createdAt), secret }
  }

  /**
   * 列出全部 API Key 的安全管理视图。
   * @returns 不包含摘要和明文的 Key 列表。
   * @remarks 过期状态根据当前时间动态计算。
   */
  async list(): Promise<ApiKeyView[]> {
    const now = this.dependencies.clock.now()
    return (await this.dependencies.repository.list()).map(record => toView(record, now))
  }

  /**
   * 吊销一个仍存在的 API Key；重复吊销保持幂等。
   * @param id API Key 标识。
   * @returns 更新后的管理视图。
   */
  async revoke(id: string): Promise<ApiKeyView> {
    const timestamp = this.dependencies.clock.now()
    const existing = (await this.dependencies.repository.list()).find(record => record.id === id)
    if (!existing) throw new ApplicationError('RESOURCE_NOT_FOUND', 'API Key 不存在', 404)
    await this.dependencies.repository.revoke(id, timestamp)
    const updated = (await this.dependencies.repository.list()).find(record => record.id === id)
    if (!updated) throw new ApplicationError('RESOURCE_NOT_FOUND', 'API Key 不存在', 404)
    return toView(updated, timestamp)
  }

  /**
   * 校验完整明文并更新最近使用时间。
   * @param secret Authorization Bearer 中的完整 Key。
   * @returns 已认证的最小主体。
   */
  async authenticate(secret: string): Promise<ApiKeyPrincipal> {
    const record = await this.dependencies.repository.findByDigest(digestApiKey(secret))
    const timestamp = this.dependencies.clock.now()
    if (!record || record.revokedAt !== null || (record.expiresAt !== null && record.expiresAt <= timestamp)) {
      throw new ApplicationError('API_KEY_INVALID', 'API Key 无效、已过期或已吊销', 401)
    }
    await this.dependencies.repository.markUsed(record.id, timestamp)
    return { id: record.id, prefix: record.keyPrefix, scopes: [...record.scopes] }
  }

  /**
   * 检查已认证 Key 是否拥有接口要求的权限。
   * @param principal 已认证 API Key 主体。
   * @param scope 接口要求的单一权限。
   * @returns 权限满足时结束。
   */
  async requireScope(principal: ApiKeyPrincipal, scope: ApiKeyScope): Promise<void> {
    if (!principal.scopes.includes(scope)) {
      throw new ApplicationError('API_SCOPE_INSUFFICIENT', `API Key 缺少 ${scope} 权限`, 403)
    }
  }
}

/**
 * 使用系统安全随机源创建 API Key 明文。
 * @returns 带固定产品版本前缀和 256 位随机量的 Key。
 * @remarks 明文只能返回给创建调用方一次。
 */
function generateApiKeySecret(): string {
  return `ry_v2_${randomBytes(32).toString('base64url')}`
}

/**
 * 计算用于等值查找且不可恢复明文的 Key 摘要。
 * @param secret 完整 API Key 明文字符串。
 * @returns 固定长度 SHA-256 十六进制摘要。
 */
function digestApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/**
 * 把数据库 Key 记录转换为管理员可见视图。
 * @param record 包含摘要的内部数据库记录。
 * @param now 用于判断过期状态的 UTC Unix 毫秒。
 * @returns 不含摘要和明文的管理视图。
 */
function toView(record: ApiKeyRecord, now: number): ApiKeyView {
  const status = record.revokedAt !== null
    ? 'revoked'
    : record.expiresAt !== null && record.expiresAt <= now ? 'expired' : 'active'
  return {
    id: record.id,
    name: record.name,
    prefix: record.keyPrefix,
    scopes: [...record.scopes],
    status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  }
}
