import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { apiKeyScopeSchema } from '../../../shared/schemas/publicApi'
import type { ApiKeyRecord, ApiKeyRepository, NewApiKeyRecord } from '../../ports/ApiKeyRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 保存不可逆 API Key 摘要和生命周期状态。 */
export class SqliteApiKeyRepository implements ApiKeyRepository {
  /** @param client 已启用外键和迁移的 SQLite 客户端。 */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @param record 不包含明文的新 Key。 @returns Key 与管理员审计原子写入后结束。 */
  async create(record: NewApiKeyRecord): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO api_keys (
          id, name, key_prefix, key_digest, scopes_json, expires_at,
          last_used_at, revoked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.name, record.keyPrefix, record.keyDigest, JSON.stringify(record.scopes),
        record.expiresAt, record.lastUsedAt, record.revokedAt, record.createdAt,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'api_key_created', targetType: 'api_key',
        targetId: record.id, details: { prefix: record.keyPrefix, scopes: record.scopes }, timestamp: record.createdAt,
      })
    })()
  }

  /** @returns 新记录在前的全部 Key。 */
  async list(): Promise<ApiKeyRecord[]> {
    return this.client.prepare(`SELECT * FROM api_keys ORDER BY created_at DESC, id DESC`).all().map(toRecord)
  }

  /** @param digest 完整 Key 摘要。 @returns 对应记录或 null。 */
  async findByDigest(digest: string): Promise<ApiKeyRecord | null> {
    const row = this.client.prepare(`SELECT * FROM api_keys WHERE key_digest = ?`).get(digest)
    return row ? toRecord(row) : null
  }

  /** @param id Key 标识。 @param timestamp 吊销时间。 @returns 是否首次吊销。 */
  async revoke(id: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const result = this.client.prepare(`
        UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
      `).run(timestamp, id)
      if (result.changes === 1) {
        insertAuditEvent(this.client, {
          actor: 'administrator', action: 'api_key_revoked', targetType: 'api_key', targetId: id, timestamp,
        })
      }
      return result.changes === 1
    })()
  }

  /**
   * 永久删除已吊销 Key 及其受外键保护的公共调用记录。
   * @param id 已吊销 API Key 标识。
   * @param timestamp 管理员执行删除的时间。
   * @returns 目标存在且已吊销时返回 true，否则返回 false。
   * @remarks 删除动作保留在管理员审计中，但该 Key 的幂等和公共调用明细会被同步清理。
   */
  async deleteRevoked(id: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const key = this.client.prepare(`SELECT id FROM api_keys WHERE id = ? AND revoked_at IS NOT NULL`).get(id)
      if (!key) return false
      this.client.prepare(`DELETE FROM public_api_idempotency_records WHERE api_key_id = ?`).run(id)
      this.client.prepare(`DELETE FROM public_api_audit_events WHERE api_key_id = ?`).run(id)
      const result = this.client.prepare(`DELETE FROM api_keys WHERE id = ? AND revoked_at IS NOT NULL`).run(id)
      if (result.changes === 1) {
        insertAuditEvent(this.client, {
          actor: 'administrator', action: 'api_key_deleted', targetType: 'api_key', targetId: id, timestamp,
        })
      }
      return result.changes === 1
    })()
  }

  /** @param id Key 标识。 @param timestamp 最近成功认证时间。 @returns 是否更新。 */
  async markUsed(id: string, timestamp: number): Promise<boolean> {
    return this.client.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(timestamp, id).changes === 1
  }
}

/** @param value SQLite 未知行。 @returns 严格解析的 API Key 记录。 */
function toRecord(value: unknown): ApiKeyRecord {
  if (typeof value !== 'object' || value === null) throw new Error('API Key 数据行无效')
  const row = value as Record<string, unknown>
  const parsedScopes: unknown = JSON.parse(String(row.scopes_json))
  const scopes = apiKeyScopeSchema.array().parse(parsedScopes)
  return {
    id: String(row.id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    keyDigest: String(row.key_digest),
    scopes,
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    createdAt: Number(row.created_at),
  }
}
