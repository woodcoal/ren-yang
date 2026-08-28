/** 人物建立时的事实来源模式。 */
export type PersonaOrigin = 'original' | 'source_based' | 'hybrid'

/** 不可变版本的生命周期状态。 */
export type VersionStatus = 'candidate' | 'published' | 'rejected'

/** 资料在证据优先级中的业务角色。 */
export type SourceRole = 'canon_fact' | 'reference' | 'style_sample'

/** MVP 支持的资料输入方式。 */
export type SourceInputType = 'paste' | 'txt' | 'markdown'

import type { PersonaSnapshot, WorldSnapshot } from '../../../shared/types/content'

export type { PersonaSnapshot, WorldSnapshot }

/** 人物元数据。 */
export interface PersonaRecord {
  /** 人物标识。 */
  id: string
  /** 可选世界设定标识。 */
  worldId: string | null
  /** 展示名称。 */
  name: string
  /** 来源模式。 */
  origin: PersonaOrigin
  /** 当前已发布版本标识。 */
  activeVersionId: string | null
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 人物不可变版本。 */
export interface PersonaVersionRecord {
  /** 版本标识。 */
  id: string
  /** 所属人物标识。 */
  personaId: string
  /** 父版本标识。 */
  parentVersionId: string | null
  /** 生命周期状态。 */
  status: VersionStatus
  /** 人物档案快照。 */
  snapshot: PersonaSnapshot
  /** 人工填写的变化摘要。 */
  changeSummary: string
  /** 发布时间。 */
  publishedAt: number | null
  /** 创建时间。 */
  createdAt: number
}

/** 世界设定元数据。 */
export interface WorldRecord {
  /** 世界标识。 */
  id: string
  /** 展示名称。 */
  name: string
  /** 简短说明。 */
  summary: string
  /** 当前已发布版本标识。 */
  activeVersionId: string | null
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 世界设定不可变版本。 */
export interface WorldVersionRecord {
  /** 版本标识。 */
  id: string
  /** 所属世界标识。 */
  worldId: string
  /** 父版本标识。 */
  parentVersionId: string | null
  /** 生命周期状态。 */
  status: VersionStatus
  /** 世界设定快照。 */
  snapshot: WorldSnapshot
  /** 人工填写的变化摘要。 */
  changeSummary: string
  /** 发布时间。 */
  publishedAt: number | null
  /** 创建时间。 */
  createdAt: number
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
