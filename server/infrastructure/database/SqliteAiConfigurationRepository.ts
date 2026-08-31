import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { aiAlgorithmStepParametersSchema } from '../../../shared/schemas/aiConfiguration'
import type { AiAlgorithmCode, AiConnectionView, AiModelDeploymentView } from '../../../shared/types/aiConfiguration'
import type {
  AiAlgorithmConfigurationRecord,
  AiConfigurationRepository,
  AiConnectionSecretRecord,
  PublishAiAlgorithmConfigurationRecord,
  SaveAiConnectionRecord,
  SaveAiModelDeploymentRecord,
} from '../../ports/AiConfigurationRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 保存加密 AI 连接、模型部署和不可变算法配置版本。 */
export class SqliteAiConfigurationRepository implements AiConfigurationRepository {
  /**
   * 创建 AI 配置仓储。
   * @param client 已迁移并启用外键的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 按创建时间与 UUID 稳定排序的全部脱敏连接。 */
  async listConnections(): Promise<AiConnectionView[]> {
    return this.client.prepare(`SELECT * FROM ai_connections ORDER BY created_at, id`).all().map(mapConnectionView)
  }

  /** @param id 连接 UUID。 @returns 含密文的服务端连接或 null。 */
  async findConnection(id: string): Promise<AiConnectionSecretRecord | null> {
    const row = this.client.prepare(`SELECT * FROM ai_connections WHERE id = ?`).get(id)
    return row ? mapConnectionSecret(row) : null
  }

  /** @param record 新连接完整记录。 @returns 创建后的脱敏连接。 */
  async createConnection(record: SaveAiConnectionRecord): Promise<AiConnectionView> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO ai_connections (
          id, name, protocol, endpoint, api_key_ciphertext, is_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.name, record.protocol, record.endpoint, record.apiKeyCiphertext,
        record.isEnabled ? 1 : 0, record.timestamp, record.timestamp,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'ai_connection_created', targetType: 'ai_connection',
        targetId: record.id, timestamp: record.timestamp,
      })
    }).immediate()
    return (await this.findConnection(record.id))!
  }

  /** @param record 替换连接记录。 @returns 更新后的脱敏连接或 null。 */
  async updateConnection(record: SaveAiConnectionRecord): Promise<AiConnectionView | null> {
    const changed = this.client.transaction(() => {
      const result = this.client.prepare(`
        UPDATE ai_connections SET name = ?, protocol = ?, endpoint = ?, api_key_ciphertext = ?,
          is_enabled = ?, updated_at = ? WHERE id = ?
      `).run(
        record.name, record.protocol, record.endpoint, record.apiKeyCiphertext,
        record.isEnabled ? 1 : 0, record.timestamp, record.id,
      )
      if (result.changes !== 1) return false
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'ai_connection_updated', targetType: 'ai_connection',
        targetId: record.id, timestamp: record.timestamp,
      })
      return true
    }).immediate()
    return changed ? (await this.findConnection(record.id))! : null
  }

  /** @returns 按创建时间与 UUID 稳定排序的全部模型部署。 */
  async listModelDeployments(): Promise<AiModelDeploymentView[]> {
    return this.client.prepare(`SELECT * FROM ai_model_deployments ORDER BY created_at, id`).all().map(mapDeployment)
  }

  /** @param id 部署 UUID。 @returns 指定模型部署或 null。 */
  async findModelDeployment(id: string): Promise<AiModelDeploymentView | null> {
    const row = this.client.prepare(`SELECT * FROM ai_model_deployments WHERE id = ?`).get(id)
    return row ? mapDeployment(row) : null
  }

  /** @param record 新部署记录。 @returns 创建后的模型部署。 */
  async createModelDeployment(record: SaveAiModelDeploymentRecord): Promise<AiModelDeploymentView> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO ai_model_deployments (
          id, connection_id, name, model, modality, is_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.connectionId, record.name, record.model, record.modality,
        record.isEnabled ? 1 : 0, record.timestamp, record.timestamp,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'ai_model_deployment_created', targetType: 'ai_model_deployment',
        targetId: record.id, timestamp: record.timestamp,
      })
    }).immediate()
    return (await this.findModelDeployment(record.id))!
  }

  /** @param record 替换部署记录。 @returns 更新后的模型部署或 null。 */
  async updateModelDeployment(record: SaveAiModelDeploymentRecord): Promise<AiModelDeploymentView | null> {
    const changed = this.client.transaction(() => {
      const result = this.client.prepare(`
        UPDATE ai_model_deployments SET connection_id = ?, name = ?, model = ?, modality = ?,
          is_enabled = ?, updated_at = ? WHERE id = ?
      `).run(
        record.connectionId, record.name, record.model, record.modality,
        record.isEnabled ? 1 : 0, record.timestamp, record.id,
      )
      if (result.changes !== 1) return false
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'ai_model_deployment_updated', targetType: 'ai_model_deployment',
        targetId: record.id, timestamp: record.timestamp,
      })
      return true
    }).immediate()
    return changed ? (await this.findModelDeployment(record.id))! : null
  }

  /** @param code 算法编码。 @returns 当前生效的完整配置或 null。 */
  async findActiveAlgorithmConfiguration(code: AiAlgorithmCode): Promise<AiAlgorithmConfigurationRecord | null> {
    const row = this.client.prepare(`
      SELECT ai_algorithm_configuration_versions.*
      FROM ai_algorithms
      INNER JOIN ai_algorithm_configuration_versions
        ON ai_algorithm_configuration_versions.id = ai_algorithms.active_configuration_version_id
      WHERE ai_algorithms.code = ?
    `).get(code)
    return row ? this.mapAlgorithmConfiguration(row) : null
  }

  /** @param code 算法编码。 @returns 已发布配置版本总数。 */
  async countAlgorithmConfigurationVersions(code: AiAlgorithmCode): Promise<number> {
    const row = this.client.prepare(`
      SELECT COUNT(*) AS count FROM ai_algorithm_configuration_versions WHERE algorithm_code = ?
    `).get(code) as { count: number }
    return Number(row.count)
  }

  /** @param record 完整新配置版本。 @returns 发布并设为当前版本后的配置。 */
  async publishAlgorithmConfiguration(record: PublishAiAlgorithmConfigurationRecord): Promise<AiAlgorithmConfigurationRecord> {
    this.client.transaction(() => {
      const versionRow = this.client.prepare(`
        SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no
        FROM ai_algorithm_configuration_versions WHERE algorithm_code = ?
      `).get(record.algorithmCode) as { version_no: number }
      this.client.prepare(`
        INSERT INTO ai_algorithm_configuration_versions (id, algorithm_code, version_no, created_at)
        VALUES (?, ?, ?, ?)
      `).run(record.id, record.algorithmCode, Number(versionRow.version_no), record.timestamp)
      const insertStep = this.client.prepare(`
        INSERT INTO ai_algorithm_step_configurations (
          id, configuration_version_id, step_key, ordinal, model_deployment_id, prompt_code, parameters_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const step of record.steps) {
        insertStep.run(
          step.id, record.id, step.stepKey, step.ordinal, step.modelDeploymentId,
          step.promptCode, JSON.stringify(step.parameters),
        )
      }
      this.client.prepare(`
        UPDATE ai_algorithms SET active_configuration_version_id = ?, updated_at = ? WHERE code = ?
      `).run(record.id, record.timestamp, record.algorithmCode)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'ai_algorithm_configuration_published', targetType: 'ai_algorithm',
        targetId: record.algorithmCode, timestamp: record.timestamp,
        details: { configurationVersion: Number(versionRow.version_no) },
      })
    }).immediate()
    return (await this.findActiveAlgorithmConfiguration(record.algorithmCode))!
  }

  /**
   * 把配置版本行与其步骤转换为完整记录。
   * @param value SQLite 返回的配置版本行。
   * @returns 解析并按顺序排列的算法配置。
   */
  private mapAlgorithmConfiguration(value: unknown): AiAlgorithmConfigurationRecord {
    const row = value as Record<string, unknown>
    const steps = (this.client.prepare(`
      SELECT * FROM ai_algorithm_step_configurations
      WHERE configuration_version_id = ? ORDER BY ordinal
    `).all(String(row.id)) as Array<Record<string, unknown>>).map(item => ({
      stepKey: String(item.step_key),
      ordinal: Number(item.ordinal),
      modelDeploymentId: String(item.model_deployment_id),
      promptCode: String(item.prompt_code),
      parameters: aiAlgorithmStepParametersSchema.parse(JSON.parse(String(item.parameters_json))),
    }))
    return {
      id: String(row.id), algorithmCode: String(row.algorithm_code) as AiAlgorithmCode,
      versionNo: Number(row.version_no), steps, createdAt: Number(row.created_at),
    }
  }
}

/**
 * 把数据库连接行转换为不含密文的公开视图。
 * @param value SQLite 返回的未知行。
 * @returns 脱敏连接视图。
 */
function mapConnectionView(value: unknown): AiConnectionView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), name: String(row.name), protocol: 'openai_compatible', endpoint: String(row.endpoint),
    hasApiKey: String(row.api_key_ciphertext).length > 0, isEnabled: Number(row.is_enabled) === 1,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/**
 * 把数据库连接行转换为仅供服务端使用的含密文记录。
 * @param value SQLite 返回的未知行。
 * @returns 含加密凭据的连接记录。
 */
function mapConnectionSecret(value: unknown): AiConnectionSecretRecord {
  const row = value as Record<string, unknown>
  return { ...mapConnectionView(row), apiKeyCiphertext: String(row.api_key_ciphertext) }
}

/**
 * 把数据库部署行转换为公开视图。
 * @param value SQLite 返回的未知行。
 * @returns 模型部署视图。
 */
function mapDeployment(value: unknown): AiModelDeploymentView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), connectionId: String(row.connection_id), name: String(row.name), model: String(row.model),
    modality: String(row.modality) as 'text' | 'image', isEnabled: Number(row.is_enabled) === 1,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}
