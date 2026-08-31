import type { AiAlgorithmStepParameters } from '../schemas/aiConfiguration'
import type { AiAlgorithmCode } from './aiConfiguration'

/** 算法测试中单个模型步骤的完整诊断结果。 */
export interface AiAlgorithmTestStepResult {
  /** 固定步骤标识。 */
  stepKey: string
  /** 管理界面步骤名称。 */
  stepName: string
  /** 固定提示词编码。 */
  promptCode: string
  /** 实际使用草稿或已发布版本。 */
  promptSource: 'draft' | 'published'
  /** 已发布版本号；使用草稿时为空。 */
  promptVersion: number | null
  /** 绑定的模型部署 UUID。 */
  modelDeploymentId: string
  /** 供应商模型标识。 */
  model: string
  /** 已脱敏的接口来源地址。 */
  endpointOrigin: string
  /** 当前步骤实际配置的可调参数。 */
  parameters: AiAlgorithmStepParameters
  /** 本步模板接收的完整变量。 */
  variables: Record<string, string>
  /** 完成变量替换后的系统提示词。 */
  systemPrompt: string
  /** 完成变量替换后的用户提示词。 */
  userPrompt: string
  /** 供应商返回的原始消息正文。 */
  rawOutput: string | null
  /** 通过当前业务 Schema 校验后的结果。 */
  parsedOutput: unknown
  /** 继续下一步时实际传递的数据；末步为空。 */
  nextStepInput: unknown
  /** 供应商报告的输入 Token；未报告时为空。 */
  inputTokens: number | null
  /** 供应商报告的输出 Token；未报告时为空。 */
  outputTokens: number | null
  /** 供应商报告的总 Token；未报告时为空。 */
  totalTokens: number | null
  /** 从模型调用开始到返回或失败的毫秒数。 */
  durationMs: number
  /** 当前步骤是否成功完成模型调用与业务解析。 */
  status: 'succeeded' | 'failed'
  /** 已脱敏错误；成功时为空。 */
  error: string | null
}

/** 一次不落库算法测试的完整结果。 */
export interface AiAlgorithmTestResult {
  /** 被测试的固定算法。 */
  algorithmCode: AiAlgorithmCode
  /** 测试使用的已发布算法配置版本。 */
  configurationVersion: number
  /** 按实际执行顺序返回的步骤；失败后不包含未执行步骤。 */
  steps: AiAlgorithmTestStepResult[]
  /** 全部步骤成功时为 true。 */
  succeeded: boolean
}
