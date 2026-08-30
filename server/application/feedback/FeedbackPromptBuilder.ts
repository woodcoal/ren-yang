/** 反馈分类使用的固定提示词编码。 */
export const FEEDBACK_CLASSIFICATION_PROMPT_CODE = 'feedback.classification'

/**
 * 构建只建议、不执行动作的反馈分类模板变量。
 * @param feedback 用户原始反馈和显式长期意图。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildFeedbackClassificationVariables(feedback: {
  content: string
  blockId: string | null
  isLongTerm: boolean
  editedOutput: string | null
}): Record<string, string> {
  return { feedbackJson: JSON.stringify(feedback) }
}
