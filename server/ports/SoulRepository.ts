import type { SoulDraftRecord, SoulSubjectType, SoulVersionRecord } from '../domain/content/ContentModels'

/** 发布灵魂草稿所需的完整持久化命令。 */
export interface PublishSoulDraftRecord {
  /** 草稿标识，用于并发状态校验。 */
  draftId: string
  /** 新不可变灵魂版本标识。 */
  versionId: string
  /** 发布时灵魂提示词 Token 数。 */
  runtimeTokenCount: number
  /** 发布时计数器与模型说明。 */
  tokenCounter: string
  /** 发布时间。 */
  timestamp: number
}

/** 灵魂草稿、不可变版本和当前版本指针的事实源端口。 */
export interface SoulRepository {
  /**
   * 查询指定模拟对象的唯一灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象标识。
   * @returns 当前草稿或 null。
   */
  findSoulDraft(subjectType: SoulSubjectType, subjectId: string): Promise<SoulDraftRecord | null>

  /**
   * 创建或完整覆盖指定模拟对象的唯一灵魂草稿。
   * @param draft 已校验且章节顺序已规范化的草稿。
   * @returns 保存后的草稿。
   */
  saveSoulDraft(draft: SoulDraftRecord): Promise<SoulDraftRecord>

  /**
   * 删除指定模拟对象当前的灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象标识。
   * @returns 删除行数。
   */
  deleteSoulDraft(subjectType: SoulSubjectType, subjectId: string): Promise<number>

  /**
   * 查询指定模拟对象的全部不可变灵魂版本。
   * @param subjectType 对象类型。
   * @param subjectId 对象标识。
   * @returns 新版本在前的版本记录。
   */
  listSoulVersions(subjectType: SoulSubjectType, subjectId: string): Promise<SoulVersionRecord[]>

  /**
   * 查询单个不可变灵魂版本。
   * @param versionId 版本标识。
   * @returns 版本或 null。
   */
  findSoulVersion(versionId: string): Promise<SoulVersionRecord | null>

  /**
   * 原子发布草稿、切换当前版本指针并删除已发布草稿。
   * @param record 发布命令。
   * @returns 发布成功后的版本；草稿状态已变化时返回 null。
   */
  publishSoulDraft(record: PublishSoulDraftRecord): Promise<SoulVersionRecord | null>
}
