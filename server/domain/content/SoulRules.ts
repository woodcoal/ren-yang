import type { SoulSnapshot } from '../../../shared/types/content'

/** 灵魂章节结构不满足领域不变式。 */
export class SoulStructureError extends Error {
  /**
   * 创建可安全展示的结构错误。
   * @param message 用户可理解的错误说明。
   */
  constructor(message: string) {
    super(message)
    this.name = 'SoulStructureError'
  }
}

/**
 * 复制灵魂快照并按数组顺序生成连续 order，避免客户端序号成为事实冲突。
 * @param snapshot 已通过共享 Schema 基础校验的灵魂快照。
 * @returns 标识唯一、顺序连续的独立快照。
 * @throws SoulStructureError 章节标识重复时抛出。
 */
export function normalizeSoulSnapshot(snapshot: SoulSnapshot): SoulSnapshot {
  const chapterIds = new Set<string>()
  const chapters = snapshot.chapters.map((chapter, order) => {
    if (chapterIds.has(chapter.id)) {
      throw new SoulStructureError(`章节标识重复：${chapter.id}`)
    }
    chapterIds.add(chapter.id)
    return {
      id: chapter.id,
      title: chapter.title.trim(),
      content: chapter.content.trim(),
      order,
      required: chapter.required,
    }
  })
  return { chapters, runtimeSummary: snapshot.runtimeSummary.trim() }
}
