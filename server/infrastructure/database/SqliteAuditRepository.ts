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
      SELECT * FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(limit).map(toAuditEvent)
  }

  /** @param input 分页参数。 @returns 新记录在前的审计分页结果。 */
  async listPage(input: ListAuditEventPageInput): Promise<AuditEventPageView> {
    const total = Number((this.client.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count)
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize))
    const page = Math.min(input.page, totalPages)
    const items = this.client.prepare(`
      SELECT * FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
    `).all(input.pageSize, (page - 1) * input.pageSize).map(toAuditEvent)
    return { items, total, page, pageSize: input.pageSize, totalPages }
  }

}

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
