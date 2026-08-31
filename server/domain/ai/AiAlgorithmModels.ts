import type { AiAlgorithmStepParameters } from '../../../shared/schemas/aiConfiguration'
import type { AiAlgorithmCode } from '../../../shared/types/aiConfiguration'

/** 算法创建任务时固定且不含访问密钥的步骤快照。 */
export interface AiAlgorithmStepSnapshot {
  /** 固定步骤标识。 */
  stepKey: string
  /** 执行顺序。 */
  ordinal: number
  /** 模型部署 UUID。 */
  modelDeploymentId: string
  /** 接口连接 UUID。 */
  connectionId: string
  /** 接口协议。 */
  protocol: 'openai_compatible'
  /** 完整接口配置的非敏感来源地址。 */
  endpoint: string
  /** 供应商模型标识。 */
  model: string
  /** 固定提示词编码。 */
  promptCode: string
  /** 固定提示词版本 UUID。 */
  promptVersionId: string
  /** 步骤调用参数。 */
  parameters: AiAlgorithmStepParameters
}

/** 一次算法运行使用的完整非敏感配置快照。 */
export interface AiAlgorithmSnapshot {
  /** 算法编码。 */
  algorithmCode: AiAlgorithmCode
  /** 代码实现版本。 */
  implementationVersion: number
  /** 不可变配置版本 UUID。 */
  configurationVersionId: string
  /** 配置版本号。 */
  configurationVersion: number
  /** 按代码定义顺序排列的步骤。 */
  steps: AiAlgorithmStepSnapshot[]
}
