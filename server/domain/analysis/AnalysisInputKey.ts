/** 可参与成长或记忆分析的原始输入标识字段。 */
export interface AnalysisInputKeySource {
  /** 输入业务类型。 */
  inputType: string
  /** 原始记录 UUID。 */
  inputId: string
  /** 当前正文哈希。 */
  contentHash: string
  /** 当前人工重要度。 */
  importance: number
}

/**
 * 生成判断一份素材当前版本是否已成功分析的稳定键。
 * @param input 输入类型、业务标识、正文哈希和人工重要度。
 * @returns 与分析仓储查询契约一致的稳定字符串。
 */
export function analysisInputKey(input: AnalysisInputKeySource): string {
  return `${input.inputType}:${input.inputId}:${input.contentHash}:${input.importance}`
}
