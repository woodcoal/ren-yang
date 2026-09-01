import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type {
  NewPublicApiAuditRecord,
  PublicApiIdempotencyRecord,
  PublicApiJsonValue,
  PublicApiRepository,
} from '../../ports/PublicApiRepository'

/** 使用 SQLite 保存公共 API 幂等结果和脱敏审计。 */
export class SqlitePublicApiRepository implements PublicApiRepository {
  /** @param client 已启用外键和迁移的 SQLite 客户端。 */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @inheritdoc */
  async findIdempotency(apiKeyId: string, method: string, path: string, idempotencyKey: string): Promise<PublicApiIdempotencyRecord | null> {
    const row = this.client.prepare(`
      SELECT * FROM public_api_idempotency_records
      WHERE api_key_id = ? AND method = ? AND path = ? AND idempotency_key = ?
    `).get(apiKeyId, method, path, idempotencyKey)
    return row ? toIdempotencyRecord(row) : null
  }

  /** @inheritdoc */
  async reserveIdempotency(record: PublicApiIdempotencyRecord): Promise<boolean> {
    return this.client.prepare(`
      INSERT OR IGNORE INTO public_api_idempotency_records (
        id, api_key_id, method, path, idempotency_key, request_hash,
        response_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      record.id, record.apiKeyId, record.method, record.path, record.idempotencyKey,
      record.requestHash, record.createdAt, record.updatedAt,
    ).changes === 1
  }

  /** @inheritdoc */
  async completeIdempotency(id: string, response: PublicApiJsonValue, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE public_api_idempotency_records SET response_json = ?, updated_at = ?
      WHERE id = ? AND response_json IS NULL
    `).run(JSON.stringify(response), timestamp, id).changes === 1
  }

  /** @inheritdoc */
  async releaseIdempotency(id: string): Promise<void> {
    this.client.prepare(`DELETE FROM public_api_idempotency_records WHERE id = ? AND response_json IS NULL`).run(id)
  }

  /** @inheritdoc */
  async appendAudit(record: NewPublicApiAuditRecord): Promise<void> {
    this.client.prepare(`
      INSERT INTO public_api_audit_events (
        id, api_key_id, request_id, method, path, target_type, target_id,
        result, status_code, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.apiKeyId, record.requestId, record.method, record.path,
      record.targetType, record.targetId, record.result, record.statusCode,
      record.errorCode, record.createdAt,
    )
  }
}

/** @param value SQLite 未知行。 @returns 严格转换的幂等记录。 */
function toIdempotencyRecord(value: unknown): PublicApiIdempotencyRecord {
  if (typeof value !== 'object' || value === null) throw new Error('公共 API 幂等数据行无效')
  const row = value as Record<string, unknown>
  return {
    id: String(row.id),
    apiKeyId: String(row.api_key_id),
    method: String(row.method),
    path: String(row.path),
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    response: row.response_json === null ? null : JSON.parse(String(row.response_json)) as PublicApiJsonValue,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}
