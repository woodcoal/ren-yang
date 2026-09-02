/** 数据库历史兼容所保留的人物来源值；不再参与业务判断。 */
export type PersonaOrigin = 'original' | 'source_based' | 'hybrid'

/** 已发布灵魂版本的生命周期状态。 */
export type VersionStatus = 'published' | 'archived' | 'rejected'

/** 灵魂所属模拟对象类型。 */
export type SoulSubjectType = 'world' | 'persona'

/** 资料在证据优先级中的业务角色。 */
export type SourceRole = 'canon_fact' | 'reference' | 'style_sample'

/** MVP 支持的资料输入方式。 */
export type SourceInputType = 'paste' | 'txt' | 'markdown'

import type { PersonaSnapshot, SoulSnapshot, WorldSnapshot } from '../../../shared/types/content'

export type { PersonaSnapshot, SoulSnapshot, WorldSnapshot }

/** 世界或人物当前唯一可编辑的灵魂草稿。 */
export interface SoulDraftRecord {
  /** 草稿标识。 */
  id: string
  /** 所属对象类型。 */
  subjectType: SoulSubjectType
  /** 所属对象标识。 */
  subjectId: string
  /** 草稿基于的已发布版本。 */
  baseVersionId: string | null
  /** 当前可编辑的单文本灵魂快照。 */
  snapshot: SoulSnapshot
  /** 本次修改说明。 */
  changeSummary: string
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 世界与人物共用的不可变灵魂版本。 */
export interface SoulVersionRecord {
  /** 灵魂版本标识。 */
  id: string
  /** 所属对象类型。 */
  subjectType: SoulSubjectType
  /** 所属对象标识。 */
  subjectId: string
  /** 父灵魂版本标识。 */
  parentVersionId: string | null
  /** 版本生命周期状态。 */
  status: VersionStatus
  /** 发布时的单文本灵魂快照。 */
  snapshot: SoulSnapshot
  /** 灵魂提示词的发布时 Token 数。 */
  runtimeTokenCount: number
  /** 发布时使用的计数器和模型说明。 */
  tokenCounter: string
  /** 人工填写的变化摘要。 */
  changeSummary: string
  /** 发布时间。 */
  publishedAt: number
  /** 创建时间。 */
  createdAt: number
}

/** 人物元数据。 */
export interface PersonaRecord {
  /** 人物标识。 */
  id: string
  /** 可选世界标识。 */
  worldId: string | null
  /** 展示名称。 */
  name: string
  /** 数据库历史兼容值；新人物固定为 original。 */
  origin: PersonaOrigin
  /** 当前已发布版本标识。 */
  activeVersionId: string | null
  /** 是否允许人物参与后续新任务。 */
  isEnabled: boolean
  /** 是否定时提炼并自动发布人物成长与记忆提示词。 */
  automaticLearningEnabled: boolean
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 人物账号信息的加密持久化记录。 */
export interface PersonaCredentialRecord {
  /** 所属人物标识。 */
  personaId: string
  /** 已规范为小写的账号；未配置时为空。 */
  username: string | null
  /** 已规范为小写的邮箱；未配置时为空。 */
  email: string | null
  /** 仅可由服务端账号信息密钥解密的密码密文；未配置时为空。 */
  passwordCiphertext: string | null
}

/** 面向人物用例的灵魂版本视图。 */
export type PersonaVersionRecord = Omit<SoulVersionRecord, 'subjectType' | 'subjectId' | 'snapshot'> & {
  /** 所属人物标识。 */
  personaId: string
  /** 人物灵魂快照。 */
  snapshot: PersonaSnapshot
}

/** 世界元数据。 */
export interface WorldRecord {
  /** 世界标识。 */
  id: string
  /** 展示名称。 */
  name: string
  /** 简短说明。 */
  summary: string
  /** 当前已发布版本标识。 */
  activeVersionId: string | null
  /** 是否允许世界参与后续新任务。 */
  isEnabled: boolean
  /** 是否定时提炼并自动发布世界成长提示词。 */
  automaticLearningEnabled: boolean
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 面向世界用例的灵魂版本视图。 */
export type WorldVersionRecord = Omit<SoulVersionRecord, 'subjectType' | 'subjectId' | 'snapshot'> & {
  /** 所属世界标识。 */
  worldId: string
  /** 世界灵魂快照。 */
  snapshot: WorldSnapshot
}

/** 资料元数据与正文。 */
export interface SourceMaterialRecord {
  /** 资料标识。 */
  id: string
  /** 展示名称。 */
  name: string
  /** 资料角色。 */
  role: SourceRole
  /** 输入方式。 */
  inputType: SourceInputType
  /** 正文 SHA-256。 */
  contentHash: string
  /** 规范化后的完整正文。 */
  contentText: string
  /** 文件导入时保留的相对路径。 */
  originalFilePath: string | null
  /** 可选原始来源地址。 */
  originUrl: string | null
  /** 可选作者或发言者。 */
  authorName: string | null
  /** 可选发表或发生时间，UTC Unix 毫秒。 */
  publishedAt: number | null
  /** 同一作品、访谈或事件跨转载与切片复用的稳定键。 */
  originalSourceKey: string | null
  /** 是否允许资料进入检索和 OpenViking 投影。 */
  isEnabled: boolean
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 资料的检索切片。 */
export interface SourceChunkRecord {
  /** 切片标识。 */
  id: string
  /** 所属资料标识。 */
  sourceId: string
  /** 从零开始的稳定序号。 */
  ordinal: number
  /** Markdown 标题上下文。 */
  heading: string | null
  /** 切片正文。 */
  content: string
  /** 切片 SHA-256。 */
  contentHash: string
}
