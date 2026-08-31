import type { AiAlgorithmStepParameters } from '../schemas/aiConfiguration'

/** 首批由代码固定流程的算法编码。 */
export type AiAlgorithmCode = 'persona_soul' | 'world_soul' | 'persona_growth' | 'world_growth'

/** 不暴露密文和明文密钥的 AI 接口连接视图。 */
export interface AiConnectionView {
  /** 连接 UUID。 */
  id: string
  /** 管理员可识别的名称。 */
  name: string
  /** 接口协议。 */
  protocol: 'openai_compatible'
  /** API 根地址或供应商兼容接口地址。 */
  endpoint: string
  /** 数据库中是否已经保存加密凭据。 */
  hasApiKey: boolean
  /** 是否允许新算法配置使用。 */
  isEnabled: boolean
  /** 创建时间。 */
  createdAt: number
  /** 最后更新时间。 */
  updatedAt: number
}

/** 一个连接上的具体模型部署视图。 */
export interface AiModelDeploymentView {
  /** 部署 UUID。 */
  id: string
  /** 所属连接 UUID。 */
  connectionId: string
  /** 管理员可识别的名称。 */
  name: string
  /** 供应商模型标识。 */
  model: string
  /** 文本或图片模型。 */
  modality: 'text' | 'image'
  /** 是否允许新算法配置使用。 */
  isEnabled: boolean
  /** 创建时间。 */
  createdAt: number
  /** 最后更新时间。 */
  updatedAt: number
}

/** 固定算法中的一个不可增删步骤定义。 */
export interface AiAlgorithmStepDefinitionView {
  /** 稳定步骤标识。 */
  key: string
  /** 中文步骤名称。 */
  name: string
  /** 步骤作用说明。 */
  description: string
  /** 固定提示词编码。 */
  promptCode: string
  /** 固定执行顺序。 */
  ordinal: number
}

/** 当前生效配置中的算法步骤。 */
export interface AiAlgorithmStepConfigurationView extends AiAlgorithmStepDefinitionView {
  /** 绑定的文本模型部署 UUID。 */
  modelDeploymentId: string
  /** 当前步骤的模型参数。 */
  parameters: AiAlgorithmStepParameters
}

/** 可由管理员维护模型与参数的固定算法视图。 */
export interface AiAlgorithmView {
  /** 稳定算法编码。 */
  code: AiAlgorithmCode
  /** 中文名称。 */
  name: string
  /** 算法作用说明。 */
  description: string
  /** 代码实现版本。 */
  implementationVersion: number
  /** 固定步骤定义。 */
  stepDefinitions: AiAlgorithmStepDefinitionView[]
  /** 当前配置版本号；尚未配置时为空。 */
  activeConfigurationVersion: number | null
  /** 当前生效步骤；尚未配置时为空数组。 */
  steps: AiAlgorithmStepConfigurationView[]
  /** 已发布配置版本总数。 */
  configurationVersionCount: number
  /** 最后更新时间。 */
  updatedAt: number
}

/** 接口连接测试的脱敏结果。 */
export interface AiConnectionCheckResult {
  /** 接口是否成功响应。 */
  healthy: boolean
  /** 检测结果说明。 */
  message: string
}
