import { randomUUID } from 'node:crypto'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { AuditEventRecord } from '../../ports/AuditRepository'

/**
 * 在调用方现有 SQLite 事务中追加不可变审计记录。
 * @param client 当前原生 SQLite 客户端。
 * @param record 已脱敏审计动作。
 * @returns 插入完成时结束。
 */
export function insertAuditEvent(client: BetterSqliteDatabase, record: AuditEventRecord): void {
  client.prepare(`
    INSERT INTO audit_events (id, actor, action, target_type, target_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    record.actor,
    record.action,
    record.targetType,
    record.targetId,
    JSON.stringify(record.details ?? {}),
    record.timestamp,
  )
}
