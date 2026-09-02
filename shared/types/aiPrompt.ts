/** AI 提示词支持的模型调用形态。 */
export type AiPromptKind = 'text' | 'image'

/** 模板中一个必须提供的变量说明。 */
export interface AiPromptVariableView {
  /** 模板变量的稳定英文名称。 */
  name: string
  /** 管理界面展示名称。 */
  label: string
  /** 变量值的来源和格式说明。 */
  description: string
  /** 变量只允许出现的消息位置；图片提示词使用 either。 */
  placement: 'system' | 'user' | 'either'
  /** 变量内容是否来自系统可信事实。 */
  trust: 'trusted' | 'untrusted'
  /** 运行时变量采用 JSON 文本还是普通标量。 */
  encoding: 'json_string' | 'scalar'
  /** 变量是否属于供应商可复用的稳定前缀。 */
  cacheRole: 'stable' | 'volatile'
}

/** 已发布且不可变的 AI 提示词版本。 */
export interface AiPromptVersionView {
  /** 版本 UUID。 */
  id: string
  /** 所属提示词稳定编码。 */
  promptCode: string
  /** 提示词内连续递增的版本号。 */
  versionNo: number
  /** 文本模型系统提示模板；图片提示词为 null。 */
  systemPromptTemplate: string | null
  /** 文本模型用户提示模板，或图片模型完整提示模板。 */
  userPromptTemplate: string
  /** 发布时填写的变化说明。 */
  changeSummary: string
  /** UTC Unix 毫秒发布时间。 */
  publishedAt: number
}

/** 尚未影响运行时的 AI 提示词草稿。 */
export interface AiPromptDraftView {
  /** 草稿 UUID。 */
  id: string
  /** 所属提示词稳定编码。 */
  promptCode: string
  /** 开始编辑时的已发布版本；首次发布前为 null。 */
  baseVersionId: string | null
  /** 文本模型系统提示模板；图片提示词为 null。 */
  systemPromptTemplate: string | null
  /** 文本模型用户提示模板，或图片模型完整提示模板。 */
  userPromptTemplate: string
  /** 草稿变化说明。 */
  changeSummary: string
  /** UTC Unix 毫秒最后更新时间。 */
  updatedAt: number
}

/** 管理界面使用的完整 AI 提示词工作区。 */
export interface AiPromptWorkspaceView {
  /** 业务调用使用的稳定编码。 */
  code: string
  /** 管理界面名称。 */
  name: string
  /** 管理界面分类。 */
  category: string
  /** 提示词用途和影响范围。 */
  description: string
  /** 文本或图片调用形态。 */
  kind: AiPromptKind
  /** 模板允许且必须提供的变量。 */
  variables: AiPromptVariableView[]
  /** 当前影响新 AI 操作的版本。 */
  activeVersion: AiPromptVersionView | null
  /** 当前尚未发布的草稿。 */
  draft: AiPromptDraftView | null
  /** 新版本在前的全部发布历史。 */
  versions: AiPromptVersionView[]
  /** UTC Unix 毫秒最后更新时间。 */
  updatedAt: number
}

/** 运行时完成变量替换后的不可变提示词。 */
export interface RenderedAiPrompt {
  /** 提示词稳定编码。 */
  code: string
  /** 实际使用的版本 UUID。 */
  versionId: string
  /** 实际使用的连续版本号。 */
  versionNo: number
  /** 文本模型系统提示；图片提示词为空字符串。 */
  systemPrompt: string
  /** 文本模型用户提示，或图片模型完整提示。 */
  userPrompt: string
}

/** 算法测试草稿优先策略渲染出的提示词。 */
export interface RenderedAiPromptForTest {
  /** 提示词稳定编码。 */
  code: string
  /** 实际使用草稿或已发布版本。 */
  source: 'draft' | 'published'
  /** 已发布版本号；草稿没有正式版本号。 */
  versionNo: number | null
  /** 完成变量替换后的系统提示词。 */
  systemPrompt: string
  /** 完成变量替换后的用户提示词。 */
  userPrompt: string
}
