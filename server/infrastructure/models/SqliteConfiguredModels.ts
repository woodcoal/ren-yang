import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { systemAiSettingsValuesSchema } from '../../../shared/schemas/systemAi'
import type { ImageModelPort, ImageModelRequest, ImageModelResponse } from '../../ports/ImageModelPort'
import { ImageModelError } from '../../ports/ImageModelPort'
import type { SecretCipher } from '../../ports/SecretCipher'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { ImageModelSnapshot, TextModelSnapshot } from '../../domain/generation/GenerationModels'
import { connectionSecretContext } from '../../application/aiConfiguration/AiConfigurationApplicationService'
import { OpenAiCompatibleImageModel } from './OpenAiCompatibleImageModel'
import { OpenAiCompatibleTextModel } from './OpenAiCompatibleTextModel'

/** 数据库默认模型解析所需的启用部署与连接行。 */
interface ConfiguredDeploymentRow {
  /** AI 连接 UUID。 */
  connection_id: string
  /** 供应商接口地址。 */
  endpoint: string
  /** 自定义 User-Agent。 */
  user_agent: string
  /** AES-GCM API Key 密文。 */
  api_key_ciphertext: string
  /** 供应商模型标识。 */
  model: string
}

/** 从系统 AI 设置与启用部署中按调用时刻解析默认模型。 */
class SqliteConfiguredModelResolver {
  /**
   * 创建数据库模型解析器。
   * @param client 已迁移的 SQLite 客户端。
   * @param secretCipher 使用本机启动密钥派生的凭据解密器。
   */
  constructor(
    private readonly client: BetterSqliteDatabase,
    private readonly secretCipher: SecretCipher,
  ) {}

  /** @returns 当前启用的默认文本模型；未选择或配置已停用时返回 null。 */
  resolveTextModel(): OpenAiCompatibleTextModel | null {
    const row = this.findDeployment('text')
    return row ? new OpenAiCompatibleTextModel(this.toOptions(row)) : null
  }

  /** @returns 当前启用的默认图片模型；未选择或配置已停用时返回 null。 */
  resolveImageModel(): OpenAiCompatibleImageModel | null {
    const row = this.findDeployment('image')
    return row ? new OpenAiCompatibleImageModel(this.toOptions(row)) : null
  }

  /**
   * 按系统设置选择并读取类型一致的启用部署及连接。
   * @param modality 文本或图片模型类型。
   * @returns 完整非公开连接行；未选择或已停用时返回 null。
   */
  private findDeployment(modality: 'text' | 'image'): ConfiguredDeploymentRow | null {
    const settingsRow = this.client.prepare(`
      SELECT values_json FROM system_ai_settings WHERE id = 'system_ai_settings'
    `).get() as { values_json: string } | undefined
    if (!settingsRow) return null
    const settings = systemAiSettingsValuesSchema.parse(JSON.parse(settingsRow.values_json))
    const deploymentId = modality === 'text' ? settings.textModelDeploymentId : settings.imageModelDeploymentId
    if (!deploymentId) return null
    const row = this.client.prepare(`
      SELECT deployment.connection_id, deployment.model, connection.endpoint,
        connection.user_agent, connection.api_key_ciphertext
      FROM ai_model_deployments AS deployment
      INNER JOIN ai_connections AS connection ON connection.id = deployment.connection_id
      WHERE deployment.id = ? AND deployment.modality = ?
        AND deployment.is_enabled = 1 AND connection.is_enabled = 1
    `).get(deploymentId, modality) as ConfiguredDeploymentRow | undefined
    return row ?? null
  }

  /**
   * 仅在创建单次适配器时把数据库密文解密到内存。
   * @param row 已启用部署与连接行。
   * @returns OpenAI-compatible 文本和图片适配器共用参数。
   */
  private toOptions(row: ConfiguredDeploymentRow) {
    return {
      endpoint: row.endpoint,
      apiKey: this.secretCipher.decrypt(row.api_key_ciphertext, connectionSecretContext(row.connection_id)),
      model: row.model,
      userAgent: row.user_agent,
    }
  }
}

/** 让既有业务服务在每次调用时使用数据库当前默认文本部署。 */
export class SqliteConfiguredTextModel implements TextModelPort {
  /** 数据库默认模型解析器。 */
  private readonly resolver: SqliteConfiguredModelResolver

  /** @param client 已迁移 SQLite 客户端。 @param secretCipher 凭据解密器。 */
  constructor(client: BetterSqliteDatabase, secretCipher: SecretCipher) {
    this.resolver = new SqliteConfiguredModelResolver(client, secretCipher)
  }

  /** @returns 当前默认文本部署的非敏感快照；未配置时返回 null。 */
  getConfiguredModel(): TextModelSnapshot | null {
    return this.resolver.resolveTextModel()?.getConfiguredModel() ?? null
  }

  /** @param request 文本模型请求。 @returns 当前数据库默认部署的响应。 */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    const model = this.resolver.resolveTextModel()
    if (!model) throw new TextModelError('CAPABILITY_DISABLED', '默认文本模型尚未配置', false)
    return await model.generateStructured(request)
  }
}

/** 让既有业务服务在每次调用时使用数据库当前默认图片部署。 */
export class SqliteConfiguredImageModel implements ImageModelPort {
  /** 数据库默认模型解析器。 */
  private readonly resolver: SqliteConfiguredModelResolver

  /** @param client 已迁移 SQLite 客户端。 @param secretCipher 凭据解密器。 */
  constructor(client: BetterSqliteDatabase, secretCipher: SecretCipher) {
    this.resolver = new SqliteConfiguredModelResolver(client, secretCipher)
  }

  /** @returns 当前默认图片部署的非敏感快照；未配置时返回 null。 */
  getConfiguredModel(): ImageModelSnapshot | null {
    return this.resolver.resolveImageModel()?.getConfiguredModel() ?? null
  }

  /** @param request 图片模型请求。 @returns 当前数据库默认部署的图片响应。 */
  async generate(request: ImageModelRequest): Promise<ImageModelResponse> {
    const model = this.resolver.resolveImageModel()
    if (!model) throw new ImageModelError('CAPABILITY_DISABLED', '默认图片模型尚未配置', false)
    return await model.generate(request)
  }
}
