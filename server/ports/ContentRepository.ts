import type {
  PersonaOrigin,
  PersonaRecord,
  PersonaSnapshot,
  PersonaVersionRecord,
  SourceChunkRecord,
  SourceInputType,
  SourceMaterialRecord,
  SourceRole,
  WorldRecord,
  WorldSnapshot,
  WorldVersionRecord,
} from '../domain/content/ContentModels'

/** 资料与人物或世界的关联记录。 */
export interface SourceLinkRecord {
  /** 可稳定用于解除关联的复合标识。 */
  id: string
  /** 关联目标类型。 */
  targetType: 'persona' | 'world'
  /** 关联目标标识。 */
  targetId: string
  /** 关联目标名称。 */
  targetName: string
  /** 数值越小优先级越高。 */
  priority: number
}

/** 创建人物聚合的持久化命令。 */
export interface CreatePersonaRecord {
  /** 人物标识。 */
  id: string
  /** 初始灵魂草稿标识。 */
  draftId: string
  /** 可选世界标识。 */
  worldId: string | null
  /** 人物名称。 */
  name: string
  /** 来源模式。 */
  origin: PersonaOrigin
  /** 初始档案快照。 */
  snapshot: PersonaSnapshot
  /** 初始变化摘要。 */
  changeSummary: string
  /** 初始关联资料。 */
  sourceIds: string[]
  /** 创建时间。 */
  timestamp: number
}

/** 创建世界聚合的持久化命令。 */
export interface CreateWorldRecord {
  /** 世界标识。 */
  id: string
  /** 初始灵魂草稿标识。 */
  draftId: string
  /** 世界名称。 */
  name: string
  /** 世界摘要。 */
  summary: string
  /** 初始世界快照。 */
  snapshot: WorldSnapshot
  /** 初始变化摘要。 */
  changeSummary: string
  /** 创建时间。 */
  timestamp: number
}

/** 创建或替换资料正文与切片的共用持久化字段。 */
export interface SourceWriteRecord {
  /** 资料标识。 */
  id: string
  /** 展示名称。 */
  name: string
  /** 业务角色。 */
  role: SourceRole
  /** 输入类型。 */
  inputType: SourceInputType
  /** 正文哈希。 */
  contentHash: string
  /** 规范化正文。 */
  contentText: string
  /** 可选原始文件相对路径。 */
  originalFilePath: string | null
  /** 检索切片。 */
  chunks: SourceChunkRecord[]
  /** 创建时间。 */
  timestamp: number
}

/** 资料创建时需要原子写入的初始关联。 */
export interface SourceCreationLinkRecord {
  /** 关联目标类型。 */
  targetType: 'persona' | 'world'
  /** 关联目标标识。 */
  targetId: string
  /** 数值越小优先级越高。 */
  priority: number
}

/** 创建资料、切片和初始关联的持久化命令。 */
export interface CreateSourceRecord extends SourceWriteRecord {
  /** 与资料在同一事务内建立的初始关联。 */
  links: SourceCreationLinkRecord[]
}

/** 替换资料正文与切片的持久化命令，不改动现有关系。 */
export interface ReplaceSourceRecord extends SourceWriteRecord {}

/** 删除人物时会一并删除的运行历史数量。 */
export interface PersonaRunHistoryStatistics {
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

/** 世界版本删除前需要检查的持久化引用数量。 */
export interface WorldVersionDeletionReferences {
  /** 直接从该版本继续修改形成的后续版本数。 */
  childVersions: number
  /** 已把该版本世界设定复制为运行证据的历史任务数。 */
  runs: number
}

/** 阶段二人物、世界与资料的持久化端口。 */
export interface ContentRepository {
  /** @returns 按更新时间倒序的人物。 */
  listPersonas(): Promise<PersonaRecord[]>
  /** @param id 人物标识。 @returns 人物或 null。 */
  findPersona(id: string): Promise<PersonaRecord | null>
  /** @param record 完整创建命令。 @returns 无返回值。 */
  createPersona(record: CreatePersonaRecord): Promise<void>
  /** @param id 人物标识。 @param name 新名称。 @param worldId 新世界标识。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updatePersona(id: string, name: string, worldId: string | null, timestamp: number): Promise<boolean>
  /** @param personaId 人物标识。 @returns 按创建时间倒序的版本。 */
  listPersonaVersions(personaId: string): Promise<PersonaVersionRecord[]>
  /** @param id 版本标识。 @returns 版本或 null。 */
  findPersonaVersion(id: string): Promise<PersonaVersionRecord | null>
  /** @param personaId 人物标识。 @returns 关联资料。 */
  listPersonaSources(personaId: string): Promise<SourceMaterialRecord[]>
  /** @param personaId 人物标识。 @returns 将随人物删除的运行历史统计。 */
  getPersonaRunHistoryStatistics(personaId: string): Promise<PersonaRunHistoryStatistics>
  /** @param personaId 人物标识。 @returns 将随人物删除的运行 UUID。 */
  listPersonaRunIds(personaId: string): Promise<string[]>
  /** @param personaId 人物标识。 @param timestamp 删除时间。 @returns 永久删除的人物行数。 */
  deletePersona(personaId: string, timestamp: number): Promise<number>

  /** @returns 按更新时间倒序的世界设定。 */
  listWorlds(): Promise<WorldRecord[]>
  /** @param id 世界标识。 @returns 世界设定或 null。 */
  findWorld(id: string): Promise<WorldRecord | null>
  /** @param record 完整创建命令。 @returns 无返回值。 */
  createWorld(record: CreateWorldRecord): Promise<void>
  /** @param id 世界标识。 @param name 新名称。 @param summary 新摘要。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updateWorld(id: string, name: string, summary: string, timestamp: number): Promise<boolean>
  /** @param worldId 世界标识。 @returns 按创建时间倒序的版本。 */
  listWorldVersions(worldId: string): Promise<WorldVersionRecord[]>
  /** @param id 版本标识。 @returns 版本或 null。 */
  findWorldVersion(id: string): Promise<WorldVersionRecord | null>
  /** @param versionId 世界版本标识。 @returns 后续版本与历史任务的引用数量。 */
  getWorldVersionDeletionReferences(versionId: string): Promise<WorldVersionDeletionReferences>
  /** @param versionId 世界版本标识。 @param timestamp 删除时间。 @returns 满足安全条件时删除的版本数。 */
  deleteWorldVersion(versionId: string, timestamp: number): Promise<number>
  /** @param worldId 世界标识。 @returns 关联人物。 */
  listWorldPersonas(worldId: string): Promise<PersonaRecord[]>
  /** @param worldId 世界标识。 @returns 关联资料。 */
  listWorldSources(worldId: string): Promise<SourceMaterialRecord[]>
  /** @param worldId 世界标识。 @param timestamp 删除时间。 @returns 永久删除的世界行数。 */
  deleteWorld(worldId: string, timestamp: number): Promise<number>

  /** @returns 按更新时间倒序的全部资料。 */
  listSources(): Promise<SourceMaterialRecord[]>
  /** @param id 资料标识。 @returns 资料或 null。 */
  findSource(id: string): Promise<SourceMaterialRecord | null>
  /** @param record 完整资料创建命令。 @returns 无返回值。 */
  createSource(record: CreateSourceRecord): Promise<void>
  /** @param record 完整资料替换命令。 @returns 是否更新成功。 */
  replaceSource(record: ReplaceSourceRecord): Promise<boolean>
  /** @param sourceId 资料标识。 @returns 顺序稳定的切片。 */
  listSourceChunks(sourceId: string): Promise<SourceChunkRecord[]>
  /** @param sourceId 资料标识。 @returns 人物和世界关联。 */
  listSourceLinks(sourceId: string): Promise<SourceLinkRecord[]>
  /** @param sourceId 资料标识。 @param targetType 目标类型。 @param targetId 目标标识。 @param priority 优先级。 @returns 无返回值。 */
  linkSource(sourceId: string, targetType: 'persona' | 'world', targetId: string, priority: number): Promise<void>
  /** @param sourceId 资料标识。 @param linkId 复合关联标识。 @returns 删除的关联数。 */
  unlinkSource(sourceId: string, linkId: string): Promise<number>
  /** @param sourceId 资料标识。 @param timestamp 删除时间。 @returns 删除的资料数。 */
  deleteSource(sourceId: string, timestamp: number): Promise<number>
  /** @param query FTS5 检索词。 @param limit 最大结果数。 @returns 已复制正文与哈希的证据候选。 */
  searchSourceChunks(query: string, limit: number): Promise<SourceChunkRecord[]>
}
