import type { SoulSubjectType } from '../../domain/content/ContentModels'

/**
 * 返回世界或人物灵魂整理使用的固定提示词编码。
 * @param subjectType 世界或人物。
 * @returns 对应的提示词稳定编码。
 */
export function soulAnalysisPromptCode(subjectType: SoulSubjectType): string {
  return subjectType === 'world' ? 'content.world_soul_analysis' : 'content.persona_soul_analysis'
}

/**
 * 构建灵魂单文本自动整理模板变量。
 * @param promptText 用户输入的原始灵魂提示词。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildSoulPromptAnalysisVariables(promptText: string): Record<string, string> {
  return { promptTextJson: JSON.stringify(promptText) }
}
