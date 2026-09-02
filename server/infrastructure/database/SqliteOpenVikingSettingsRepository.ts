import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { OpenVikingSettingsView } from '../../../shared/types/context'
import type {
  OpenVikingSettingsRepository,
  OpenVikingSettingsSecretRecord,
  SaveOpenVikingSettingsRecord,
} from '../../ports/OpenVikingSettingsRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 保存唯一 OpenViking 配置和加密 ADMIN Key。 */
export class SqliteOpenVikingSettingsRepository implements OpenVikingSettingsRepository {
  /** @param client 已迁移 SQLite 客户端。 */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 当前含密文设置；尚未保存时返回 null。 */
  async find(): Promise<OpenVikingSettingsSecretRecord | null> {
    return this.findCurrent()
  }

  /** @returns 当前含密文设置的同步读取结果。 */
  findCurrent(): OpenVikingSettingsSecretRecord | null {
    const row = this.client.prepare(`
      SELECT enabled, endpoint, account_id, api_key_ciphertext, timeout_ms, updated_at
      FROM openviking_settings WHERE id = 'openviking_settings'
    `).get() as Record<string, unknown> | undefined
    return row ? mapSecretRecord(row) : null
  }

  /** @param record 完整替换记录。 @returns 保存后的脱敏设置。 */
  async save(record: SaveOpenVikingSettingsRecord): Promise<OpenVikingSettingsView> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO openviking_settings (
          id, enabled, endpoint, account_id, api_key_ciphertext, timeout_ms, updated_at
        ) VALUES ('openviking_settings', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, endpoint = excluded.endpoint,
          account_id = excluded.account_id,
          api_key_ciphertext = excluded.api_key_ciphertext, timeout_ms = excluded.timeout_ms,
          updated_at = excluded.updated_at
      `).run(record.enabled ? 1 : 0, record.endpoint, record.accountId, record.apiKeyCiphertext, record.timeoutMs, record.timestamp)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'openviking_settings_updated',
        targetType: 'openviking_settings', targetId: 'openviking_settings', timestamp: record.timestamp,
        details: { enabled: record.enabled },
      })
    }).immediate()
    const saved = this.findCurrent()
    if (!saved) throw new Error('OpenViking 设置写入后无法读取')
    return toView(saved)
  }
}

/** @param row SQLite 未知行。 @returns 规范化的含密文设置。 */
function mapSecretRecord(row: Record<string, unknown>): OpenVikingSettingsSecretRecord {
  const apiKeyCiphertext = String(row.api_key_ciphertext)
  return {
    enabled: Number(row.enabled) === 1,
    endpoint: String(row.endpoint),
    accountId: String(row.account_id),
    hasApiKey: apiKeyCiphertext.length > 0,
    apiKeyCiphertext,
    timeoutMs: Number(row.timeout_ms),
    updatedAt: Number(row.updated_at),
  }
}

/** @param record 含密文设置。 @returns 不包含密文的后台视图。 */
function toView(record: OpenVikingSettingsSecretRecord): OpenVikingSettingsView {
  const { apiKeyCiphertext: _apiKeyCiphertext, ...view } = record
  return view
}
