import type { EvaluationCaseRecord } from '../../domain/feedback/FeedbackModels'
import type { PersonaSnapshot } from '../../../shared/types/content'

/** 反馈分类提示版本。 */
export const FEEDBACK_CLASSIFICATION_PROMPT_VERSION = 'feedback-classification-v1'

/** 人物比较评测提示版本。 */
export const PERSONA_EVALUATION_PROMPT_VERSION = 'persona-evaluation-v1'

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
- parameters：只调整温度、长度等本次运行参数；
- persona：用户明确要求形成跨运行稳定人物变化；
- source_fact：用户指出参考资料事实错误或冲突。
自由文本负面评价不能自行证明长期人格变化。isLongTerm=true 是长期意图的重要证据，但仍需按内容判断。只输出 targetType、confidence、rationale 的 JSON 对象，不执行任何修改，不输出隐藏推理。`,
    userPrompt: `<不可信用户反馈>${JSON.stringify(feedback)}</不可信用户反馈>`,
  }
}

/**
 * 构建固定基础版本与候选版本的单用例比较评测提示。
 * @param baseSnapshot 基础人物不可变快照。
 * @param candidateSnapshot 候选人物不可变快照。
 * @param evaluationCase 固定评测输入与断言。
 * @returns 要求同时模拟两版输出并独立评分的提示。
 */
export function buildPersonaEvaluationPrompt(
  baseSnapshot: PersonaSnapshot,
  candidateSnapshot: PersonaSnapshot,
  evaluationCase: EvaluationCaseRecord,
) {
  return {
    systemPrompt: `你是固定人物回归评测器。对同一评测输入分别模拟基础人物和候选人物的简短公开输出，并按该用例目标独立给出 0 到 1 分。不得因为版本较新而提高候选分数。资料不足时承认未知。只输出 baseOutput、candidateOutput、baseScore、candidateScore、reasoningSummary 的 JSON 对象；说明必须简短，不输出隐藏推理。`,
    userPrompt: `<基础人物>${JSON.stringify(baseSnapshot)}</基础人物>
<候选人物>${JSON.stringify(candidateSnapshot)}</候选人物>
<固定评测用例>${JSON.stringify({
      name: evaluationCase.name,
      category: evaluationCase.category,
      prompt: evaluationCase.prompt,
      expectedChange: evaluationCase.expectedChange,
      requiredTerms: evaluationCase.requiredTerms,
      forbiddenTerms: evaluationCase.forbiddenTerms,
      minimumScore: evaluationCase.minimumScore,
      maxRegression: evaluationCase.maxRegression,
    })}</固定评测用例>`,
  }
}
