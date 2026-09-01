import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { AuditEventPageView, AuditEventView } from '../../../shared/types/system'
import type { AuditRepository, ListAuditEventPageInput } from '../../ports/AuditRepository'

/** 使用 SQLite 保存和读取不可变关键动作审计历史。 */
export class SqliteAuditRepository implements AuditRepository {
  /** @param client 已迁移并启用外键的 SQLite 客户端。 */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @param limit 最大返回数量。 @returns 新记录在前的审计历史。 */
  async list(limit: number): Promise<AuditEventView[]> {
    return this.client.prepare(`
      ${ALL_AUDIT_EVENTS_SQL}
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(limit).map(toAuditEvent)
  }

  /** @param input 分页参数。 @returns 新记录在前的审计分页结果。 */
  async listPage(input: ListAuditEventPageInput): Promise<AuditEventPageView> {
    const total = Number((this.client.prepare(`
      SELECT (
        (SELECT COUNT(*) FROM audit_events) +
        (SELECT COUNT(*) FROM public_api_audit_events)
      ) AS count
    `).get() as { count: number }).count)
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize))
    const page = Math.min(input.page, totalPages)
    const items = this.client.prepare(`
      ${ALL_AUDIT_EVENTS_SQL}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(input.pageSize, (page - 1) * input.pageSize).map(toAuditEvent)
    return { items, total, page, pageSize: input.pageSize, totalPages }
  }

}

/** 管理审计与公共 API 审计的统一只读投影；不复制 Key 明文或业务正文。 */
const ALL_AUDIT_EVENTS_SQL = `
  SELECT id, actor, action, target_type, target_id, details_json, created_at
  FROM audit_events
  UNION ALL
  SELECT
    id,
    'api_key' AS actor,
    'public_api_request' AS action,
    target_type,
    target_id,
    json_object(
      'apiKeyId', api_key_id,
      'requestId', request_id,
      'method', method,
      'path', path,
      'result', result,
      'statusCode', status_code,
      'errorCode', error_code
    ) AS details_json,
    created_at
  FROM public_api_audit_events
`

/** @param value SQLite 审计行。 @returns 管理界面审计视图。 */
function toAuditEvent(value: unknown): AuditEventView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id),
    actor: row.actor as AuditEventView['actor'],
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: row.target_id === null ? null : String(row.target_id),
    details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
    createdAt: Number(row.created_at),
  }
}
