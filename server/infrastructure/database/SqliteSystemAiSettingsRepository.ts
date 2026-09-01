import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { systemAiSettingsValuesSchema, type SystemAiSettingsValues } from '../../../shared/schemas/systemAi'
import type { SystemAiSettingsView } from '../../../shared/types/systemAi'
import type { SystemAiSettingsRepository } from '../../ports/SystemAiSettingsRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用现有单例表保存默认文本与图片模型。 */
export class SqliteSystemAiSettingsRepository implements SystemAiSettingsRepository {
  /** @param client 已迁移并启用外键的 SQLite 客户端。 */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 已保存默认模型；尚未保存时返回 null。 */
  async find(): Promise<SystemAiSettingsView | null> {
    const value = this.client.prepare(`
      SELECT values_json, updated_at FROM system_ai_settings WHERE id = 'system_ai_settings'
    `).get()
    if (!value) return null
    const row = value as { values_json: string, updated_at: number }
    return {
      values: systemAiSettingsValuesSchema.parse(JSON.parse(row.values_json)),
      updatedAt: Number(row.updated_at),
    }
  }

  /**
   * 完整替换默认文本与图片模型并记录管理员审计。
   * @param values 已校验的两个默认部署选择。
   * @param timestamp 保存发生的 Unix 毫秒时间。
   * @returns 保存后的设置视图。
   */
  async save(values: SystemAiSettingsValues, timestamp: number): Promise<SystemAiSettingsView> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO system_ai_settings (id, values_json, updated_at)
        VALUES ('system_ai_settings', ?, ?)
        ON CONFLICT(id) DO UPDATE SET values_json = excluded.values_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(values), timestamp)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'system_ai_settings_updated',
        targetType: 'system_ai_settings', targetId: 'system_ai_settings', timestamp,
      })
    }).immediate()
    return { values: { ...values }, updatedAt: timestamp }
  }
}
