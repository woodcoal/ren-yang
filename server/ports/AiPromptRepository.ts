import type { AiPromptDraftView, AiPromptKind, AiPromptVariableView, AiPromptVersionView } from '../../shared/types/aiPrompt'

/** AI 提示词固定定义记录。 */
export interface AiPromptDefinitionRecord {
  /** 业务调用使用的稳定编码。 */
  code: string
  /** 管理界面名称。 */
  name: string
  /** 管理界面分类。 */
  category: string
  /** 用途和影响范围。 */
  description: string
  /** 文本或图片调用形态。 */
  kind: AiPromptKind
  /** 模板变量契约。 */
  variables: AiPromptVariableView[]
  /** 当前已发布版本 UUID。 */
  activeVersionId: string | null
  /** 最后更新时间。 */
  updatedAt: number
}

/** 保存 AI 提示词草稿的数据记录。 */
export interface SaveAiPromptDraftRecord {
  /** 新草稿需要使用的 UUID。 */
  id: string
  /** 提示词稳定编码。 */
  promptCode: string
  /** 编辑开始时的已发布版本 UUID。 */
  baseVersionId: string | null
  /** 文本模型系统提示模板；图片提示词为 null。 */
  systemPromptTemplate: string | null
  /** 文本模型用户提示模板，或图片完整提示模板。 */
  userPromptTemplate: string
  /** 修改说明。 */
  changeSummary: string
  /** 创建或更新时间。 */
  timestamp: number
}

/** 仓储内部使用的不可变提示词版本及其变量契约快照。 */
export interface AiPromptVersionRecord extends AiPromptVersionView {
  /** 发布时固定的变量契约。 */
  variables: AiPromptVariableView[]
  /** 变量契约 JSON 的 SHA-256；迁移前历史版本可能为空。 */
  variableContractHash: string | null
}

/** AI 提示词定义、草稿和不可变版本的事实源。 */
export interface AiPromptRepository {
  /** @returns 按分类和名称排序的全部固定提示词定义。 */
  listDefinitions(): Promise<AiPromptDefinitionRecord[]>
  /** @param code 提示词稳定编码。 @returns 定义或 null。 */
  findDefinition(code: string): Promise<AiPromptDefinitionRecord | null>
  /** @param code 提示词稳定编码。 @returns 当前草稿或 null。 */
  findDraft(code: string): Promise<AiPromptDraftView | null>
  /** @param code 提示词稳定编码。 @returns 新版本在前的全部历史。 */
  listVersions(code: string): Promise<AiPromptVersionView[]>
  /** @param versionId 版本 UUID。 @returns 指定不可变版本或 null。 */
  findVersion(versionId: string): Promise<AiPromptVersionRecord | null>
  /** @param record 完整草稿记录。 @returns 保存后的草稿。 */
  saveDraft(record: SaveAiPromptDraftRecord): Promise<AiPromptDraftView>
  /** @param code 提示词稳定编码。 @returns 删除到草稿时为 true。 */
  deleteDraft(code: string): Promise<boolean>
  /** @param code 提示词编码。 @param expectedDraftUpdatedAt 预期草稿更新时间。 @param versionId 新版本 UUID。 @param timestamp 发布时间。 @returns 发布后的版本；并发冲突时为 null。 */
  publishDraft(code: string, expectedDraftUpdatedAt: number, versionId: string, timestamp: number): Promise<AiPromptVersionView | null>
}
