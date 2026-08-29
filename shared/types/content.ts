/** 人物档案的完整不可变快照。 */
export interface PersonaSnapshot {
  /** 人物的一句话定位。 */
  summary: string
  /** 身份、背景、经历与关系事实。 */
  identityFacts: string
  /** 主题与内容偏好。 */
  interests: string
  /** 决策依据、目标与动机。 */
  valuesAndMotivations: string
  /** 用词、语气与结构习惯。 */
  expressionStyle: string
  /** 外貌与服饰描述。 */
  appearance: string
  /** 构图、色彩与质感偏好。 */
  visualStyle: string
  /** 事实边界、禁用项与安全要求。 */
  constraints: string
}

/** 自然语言生成但尚未保存的人物候选草稿。 */
export interface PersonaDraftView {
  /** 模型建议的人物名称。 */
  name: string
  /** 模型建议的结构化人物快照。 */
  snapshot: PersonaSnapshot
  /** 参考资料被截断等不影响人工继续编辑的提示。 */
  warnings: string[]
}

/** 世界设定的完整不可变快照。 */
export interface WorldSnapshot {
  /** 世界规则与背景正文。 */
  content: string
}

/** 人物列表项。 */
export interface PersonaSummary {
  /** 人物 UUID。 */
  id: string
  /** 可选世界 UUID。 */
  worldId: string | null
  /** 可选世界名称。 */
  worldName: string | null
  /** 人物展示名称。 */
  name: string
  /** 人物来源模式。 */
  origin: 'original' | 'source_based' | 'hybrid'
  /** 当前已发布版本 UUID。 */
  activeVersionId: string | null
  /** 当前已发布版本的人物定位。 */
  currentSummary: string | null
  /** 保留版本总数。 */
  versionCount: number
  /** 直接关联资料数。 */
  sourceCount: number
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 更新时间，UTC Unix 毫秒。 */
  updatedAt: number
}

/** 人物版本公开视图。 */
export interface PersonaVersionView {
  /** 版本 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 父版本 UUID。 */
  parentVersionId: string | null
  /** 版本生命周期状态。 */
  status: 'candidate' | 'published' | 'rejected'
  /** 不可变人物档案快照。 */
  snapshot: PersonaSnapshot
  /** 人工填写的变化摘要。 */
  changeSummary: string
  /** 发布时间，未发布时为 null。 */
  publishedAt: number | null
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
}

/** 世界列表项。 */
export interface WorldSummary {
  /** 世界 UUID。 */
  id: string
  /** 世界展示名称。 */
  name: string
  /** 可变简短摘要。 */
  summary: string
  /** 当前已发布版本 UUID。 */
  activeVersionId: string | null
  /** 当前已发布世界正文。 */
  currentContent: string | null
  /** 保留版本总数。 */
  versionCount: number
  /** 直接关联人物数。 */
  personaCount: number
  /** 直接关联资料数。 */
  sourceCount: number
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 更新时间，UTC Unix 毫秒。 */
  updatedAt: number
}

/** 世界版本公开视图。 */
export interface WorldVersionView {
  /** 版本 UUID。 */
  id: string
  /** 所属世界 UUID。 */
  worldId: string
  /** 父版本 UUID。 */
  parentVersionId: string | null
  /** 版本生命周期状态。 */
  status: 'candidate' | 'published' | 'rejected'
  /** 不可变世界正文快照。 */
  snapshot: WorldSnapshot
  /** 人工填写的变化摘要。 */
  changeSummary: string
  /** 发布时间，未发布时为 null。 */
  publishedAt: number | null
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
}

/** 资料公开视图。 */
export interface SourceSummary {
  /** 资料 UUID。 */
  id: string
  /** 资料展示名称。 */
  name: string
  /** 证据优先级中的资料角色。 */
  role: 'canon_fact' | 'reference' | 'style_sample'
  /** 原始输入方式。 */
  inputType: 'paste' | 'txt' | 'markdown'
  /** 规范化正文 SHA-256。 */
  contentHash: string
  /** 规范化后的完整正文。 */
  contentText: string
  /** 文件导入时保留的相对路径。 */
  originalFilePath: string | null
  /** 当前检索切片数。 */
  chunkCount: number
  /** 当前人物与世界关联数。 */
  linkCount: number
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 更新时间，UTC Unix 毫秒。 */
  updatedAt: number
}

/** 资料关联公开视图。 */
export interface SourceLinkView {
  /** 可用于解除关联的稳定复合标识。 */
  id: string
  /** 关联目标类型。 */
  targetType: 'persona' | 'world'
  /** 关联目标 UUID。 */
  targetId: string
  /** 关联目标展示名称。 */
  targetName: string
  /** 数值越小优先级越高。 */
  priority: number
}

/** 资料切片或检索证据候选。 */
export interface SourceChunkView {
  /** 切片 UUID。 */
  id: string
  /** 所属资料 UUID。 */
  sourceId: string
  /** 从零开始的稳定序号。 */
  ordinal: number
  /** 最近的 Markdown 标题上下文。 */
  heading: string | null
  /** 切片正文，可在后续运行中复制为证据快照。 */
  content: string
  /** 切片正文 SHA-256。 */
  contentHash: string
}

/** 人物详情。 */
export interface PersonaDetails {
  /** 人物摘要。 */
  persona: PersonaSummary
  /** 新版本在前的完整版本历史。 */
  versions: PersonaVersionView[]
  /** 当前直接关联资料。 */
  sources: SourceSummary[]
}

/** 世界详情。 */
export interface WorldDetails {
  /** 世界摘要。 */
  world: WorldSummary
  /** 新版本在前的完整版本历史。 */
  versions: WorldVersionView[]
  /** 当前直接关联人物。 */
  personas: PersonaSummary[]
  /** 当前直接关联资料。 */
  sources: SourceSummary[]
}

/** 资料详情。 */
export interface SourceDetails {
  /** 资料摘要与正文。 */
  source: SourceSummary
  /** 顺序稳定的检索切片。 */
  chunks: SourceChunkView[]
  /** 当前人物与世界关联。 */
  links: SourceLinkView[]
}

/** 不可变版本的字段差异。 */
export interface VersionFieldDiff {
  /** 稳定字段键。 */
  field: string
  /** 中文字段标签。 */
  label: string
  /** 基础版本字段值。 */
  before: string
  /** 目标版本字段值。 */
  after: string
}

/** 删除前返回的明确影响范围。 */
export interface DeletionImpact {
  /** 待删除资源类型。 */
  resourceType: 'persona' | 'world' | 'source'
  /** 待删除资源 UUID。 */
  resourceId: string
  /** 当前是否满足永久删除条件。 */
  canDelete: boolean
  /** 阻止删除的可操作原因。 */
  blockers: string[]
  /** 关联人物。 */
  relatedPersonas: Array<{ id: string, name: string }>
  /** 关联世界。 */
  relatedWorlds: Array<{ id: string, name: string }>
  /** 关联资料。 */
  relatedSources: Array<{ id: string, name: string }>
  /** 将被级联删除的版本数。 */
  versionCount: number
  /** 人物删除时将被级联删除的运行历史统计。 */
  runHistory: {
    /** 运行数量。 */
    runs: number
    /** 持久任务数量。 */
    tasks: number
    /** 证据快照数量。 */
    evidenceSnapshots: number
    /** 文档规格修订数量。 */
    documentSpecs: number
    /** 产物块数量。 */
    artifactBlocks: number
    /** 块尝试数量。 */
    blockAttempts: number
  }
  /** 将被删除的本地文件相对路径。 */
  files: string[]
}
