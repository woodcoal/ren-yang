import type { SoulSubjectType } from '../../domain/content/ContentModels'

/**
 * 构建灵魂单文本自动整理提示，要求模型只重组表达而不增加用户未提供的事实。
 * @param subjectType 世界或人物。
 * @param promptText 用户输入的原始灵魂提示词。
 * @returns 分层系统提示与用户提示。
 */
export function buildSoulPromptAnalysisPrompt(
  subjectType: SoulSubjectType,
  promptText: string,
): { systemPrompt: string, userPrompt: string } {
  const subjectLabel = subjectType === 'world' ? '世界' : '人物'
  return {
    systemPrompt: `你是${subjectLabel}灵魂提示词整理器。必须遵守以下规则：
1. 只整理用户提供的事实、偏好、风格和约束，不得新增、推测或补全任何设定。
2. 输出仍是一段可直接用于模型系统提示的纯文本；允许使用简短 Markdown 标题和列表提高可读性。
3. 删除重复表达，但不得删除会改变行为的事实、边界、禁令或例外。
4. 禁止写入候选、确认、发布、AI 生成、分析过程或面向用户的解释。
5. 只输出一个 JSON 对象，且只能包含 promptText 字符串字段。`,
    userPrompt: `<待整理${subjectLabel}灵魂>${JSON.stringify(promptText)}</待整理${subjectLabel}灵魂>`,
  }
}
