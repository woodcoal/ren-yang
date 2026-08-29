/** 反馈分类提示版本。 */
export const FEEDBACK_CLASSIFICATION_PROMPT_VERSION = 'feedback-classification-v2'

/**
 * 构建只建议、不执行动作的反馈目标分类提示。
 * @param feedback 用户原始反馈和显式长期意图。
 * @returns 固定系统规则和边界清晰的用户数据。
 */
export function buildFeedbackClassificationPrompt(feedback: {
  content: string
  blockId: string | null
  isLongTerm: boolean
  editedOutput: string | null
}) {
  return {
    systemPrompt: `你是反馈归因分类器，只能建议以下一个目标：
- artifact：只修正当前运行的具体结果或产物块；
- parameters：只记录温度、长度等后续运行参数建议；
- persona：用户明确希望把反馈作为人物学习资料，后续仍需成长分析和人工审核；
- source_fact：用户指出参考资料事实错误或冲突。
自由文本评价不能自行修改人物灵魂、成长或记忆。isLongTerm=true 是人物学习意图的重要证据，但分类结果仍必须由用户确认。只输出 targetType、confidence、rationale 的 JSON 对象，不执行任何修改，不输出隐藏推理。`,
    userPrompt: `<不可信用户反馈>${JSON.stringify(feedback)}</不可信用户反馈>`,
  }
}
