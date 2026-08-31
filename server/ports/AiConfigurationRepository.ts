import type { AiAlgorithmStepParameters } from '../../shared/schemas/aiConfiguration'
import type { AiAlgorithmCode, AiConnectionView, AiModelDeploymentView } from '../../shared/types/aiConfiguration'

/** 仅供服务端解密和动态执行使用的连接记录。 */
export interface AiConnectionSecretRecord extends AiConnectionView {
  /** AES-GCM 版本化密文。 */
  apiKeyCiphertext: string
}

/** 创建或替换 AI 连接时写入的完整持久化记录。 */
export interface SaveAiConnectionRecord {
  /** 连接 UUID。 */
  id: string
  /** 管理名称。 */
  name: string
  /** 接口协议。 */
  protocol: 'openai_compatible'
  /** 服务地址。 */
  endpoint: string
  /** 请求该连接时使用的自定义 User-Agent。 */
  userAgent: string
  /** 已使用连接 UUID 作为上下文加密的凭据。 */
  apiKeyCiphertext: string
  /** 是否启用。 */
  isEnabled: boolean
  /** 本次写入时间。 */
  timestamp: number
}

/** 创建或替换模型部署时写入的完整记录。 */
export interface SaveAiModelDeploymentRecord {
  /** 部署 UUID。 */
  id: string
  /** 所属连接 UUID。 */
  connectionId: string
  /** 管理名称。 */
  name: string
  /** 供应商模型标识。 */
  model: string
  /** 文本或图片模型。 */
  modality: 'text' | 'image'
  /** 是否启用。 */
  isEnabled: boolean
  /** 本次写入时间。 */
  timestamp: number
}

/** 算法配置版本内的一项不可变步骤记录。 */
export interface AiAlgorithmStepConfigurationRecord {
  /** 固定步骤标识。 */
  stepKey: string
  /** 固定执行顺序。 */
  ordinal: number
  /** 文本模型部署 UUID。 */
  modelDeploymentId: string
  /** 固定提示词编码。 */
  promptCode: string
  /** 模型调用参数。 */
  parameters: AiAlgorithmStepParameters
}

/** 当前或指定版本的完整算法配置记录。 */
export interface AiAlgorithmConfigurationRecord {
  /** 配置版本 UUID。 */
  id: string
  /** 算法编码。 */
  algorithmCode: AiAlgorithmCode
  /** 版本号。 */
  versionNo: number
  /** 步骤记录。 */
  steps: AiAlgorithmStepConfigurationRecord[]
  /** 创建时间。 */
  createdAt: number
}

/** 发布一版算法配置时使用的写入记录。 */
export interface PublishAiAlgorithmConfigurationRecord {
  /** 配置版本 UUID。 */
  id: string
  /** 算法编码。 */
  algorithmCode: AiAlgorithmCode
  /** 每个步骤使用的 UUID 与完整配置。 */
  steps: Array<AiAlgorithmStepConfigurationRecord & { id: string }>
  /** 发布时间。 */
  timestamp: number
}

/** AI 接口、模型部署与算法配置版本的持久化端口。 */
export interface AiConfigurationRepository {
  /** @returns 按创建时间排列的脱敏连接。 */
  listConnections(): Promise<AiConnectionView[]>
  /** @param id 连接 UUID。 @returns 含密文的服务端记录或 null。 */
  findConnection(id: string): Promise<AiConnectionSecretRecord | null>
  /** @param record 新连接记录。 @returns 创建后的脱敏连接。 */
  createConnection(record: SaveAiConnectionRecord): Promise<AiConnectionView>
  /** @param record 替换记录。 @returns 更新后的脱敏连接或 null。 */
  updateConnection(record: SaveAiConnectionRecord): Promise<AiConnectionView | null>
  /** @returns 全部模型部署。 */
  listModelDeployments(): Promise<AiModelDeploymentView[]>
  /** @param id 部署 UUID。 @returns 模型部署或 null。 */
  findModelDeployment(id: string): Promise<AiModelDeploymentView | null>
  /** @param record 新部署记录。 @returns 创建后的模型部署。 */
  createModelDeployment(record: SaveAiModelDeploymentRecord): Promise<AiModelDeploymentView>
  /** @param record 替换记录。 @returns 更新后的模型部署或 null。 */
  updateModelDeployment(record: SaveAiModelDeploymentRecord): Promise<AiModelDeploymentView | null>
  /** @param code 算法编码。 @returns 当前生效配置或 null。 */
  findActiveAlgorithmConfiguration(code: AiAlgorithmCode): Promise<AiAlgorithmConfigurationRecord | null>
  /** @param code 算法编码。 @returns 已发布配置版本数量。 */
  countAlgorithmConfigurationVersions(code: AiAlgorithmCode): Promise<number>
  /** @param record 完整新版本。 @returns 发布后的配置。 */
  publishAlgorithmConfiguration(record: PublishAiAlgorithmConfigurationRecord): Promise<AiAlgorithmConfigurationRecord>
}
