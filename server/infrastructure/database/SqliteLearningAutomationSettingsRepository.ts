import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { LearningAutomationSettingsView } from '../../../shared/types/learningAutomation'
import type { LearningAutomationSettingsRepository } from '../../ports/LearningAutomationSettingsRepository'

const SETTINGS_ID = 'learning_automation_settings'
const HOUR_MS = 60 * 60 * 1_000

/** 使用 SQLite 单例行保存学习自动化周期并原子领取到期扫描。 */
export class SqliteLearningAutomationSettingsRepository implements LearningAutomationSettingsRepository {
  /** @param client 已完成迁移的 SQLite 客户端。 */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 当前持久化周期设置。 */
  async find(): Promise<LearningAutomationSettingsView> {
    const row = this.client.prepare('SELECT * FROM learning_automation_settings WHERE id = ?').get(SETTINGS_ID)
    if (!row) throw new Error('学习自动化设置缺失')
    return toView(row)
  }

  /** @param intervalHours 新周期小时数。 @param timestamp 保存时间。 @returns 更新后的设置。 */
  async update(intervalHours: number, timestamp: number): Promise<LearningAutomationSettingsView> {
    this.client.prepare(`
      UPDATE learning_automation_settings
      SET interval_hours = ?, next_run_at = ?, updated_at = ? WHERE id = ?
    `).run(intervalHours, timestamp + intervalHours * HOUR_MS, timestamp, SETTINGS_ID)
    return await this.find()
  }

  /** @param timestamp 当前时间。 @returns 本次是否原子领取到到期周期。 */
  async claimDueCycle(timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const row = this.client.prepare(`
        SELECT interval_hours, next_run_at FROM learning_automation_settings WHERE id = ?
      `).get(SETTINGS_ID) as { interval_hours: number, next_run_at: number } | undefined
      if (!row || Number(row.next_run_at) > timestamp) return false
      return this.client.prepare(`
        UPDATE learning_automation_settings SET next_run_at = ?, last_run_at = ?, updated_at = ?
        WHERE id = ? AND next_run_at <= ?
      `).run(timestamp + Number(row.interval_hours) * HOUR_MS, timestamp, timestamp, SETTINGS_ID, timestamp).changes === 1
    }).immediate()
  }
}

/** @param value SQLite 设置行。 @returns 类型安全的公开设置。 */
function toView(value: unknown): LearningAutomationSettingsView {
  const row = value as Record<string, unknown>
  return {
    intervalHours: Number(row.interval_hours),
    nextRunAt: Number(row.next_run_at),
    lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
    updatedAt: Number(row.updated_at),
  }
}
