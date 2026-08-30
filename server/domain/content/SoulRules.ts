import type { SoulSnapshot } from '../../../shared/types/content'

/**
 * 规范化单文本灵魂快照，只移除整段文本首尾空白，不改写用户正文。
 * @param snapshot 已通过共享 Schema 基础校验的灵魂快照。
 * @returns 可直接保存和进入任务提示词的独立快照。
 */
export function normalizeSoulSnapshot(snapshot: SoulSnapshot): SoulSnapshot {
  return { promptText: snapshot.promptText.trim() }
}
