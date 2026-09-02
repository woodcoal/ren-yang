import type {
  PersonaOrigin,
  PersonaCredentialRecord,
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
  /** 初始灵魂版本标识。 */
  versionId: string
  /** 可选世界标识。 */
  worldId: string | null
  /** 人物名称。 */
  name: string
  /** 可选账号。 */
  username: string | null
  /** 可选邮箱。 */
  email: string | null
  /** 可选密码密文。 */
  passwordCiphertext: string | null
  /** 数据库兼容值；来源模式已退出业务。 */
  origin: PersonaOrigin
  /** 初始档案快照。 */
  snapshot: PersonaSnapshot
  /** 初始变化摘要。 */
  changeSummary: string
  /** 初始灵魂提示词 Token 数。 */
  runtimeTokenCount: number
  /** 初始灵魂提示词计数器标识。 */
  tokenCounter: string
  /** 初始关联资料。 */
  sourceIds: string[]
  /** 创建时间。 */
  timestamp: number
}

/** 创建世界聚合的持久化命令。 */
export interface CreateWorldRecord {
  /** 世界标识。 */
  id: string
  /** 初始灵魂版本标识。 */
  versionId: string
  /** 世界名称。 */
  name: string
  /** 世界摘要。 */
  summary: string
  /** 初始世界快照。 */
  snapshot: WorldSnapshot
  /** 初始变化摘要。 */
  changeSummary: string
  /** 初始灵魂提示词 Token 数。 */
  runtimeTokenCount: number
  /** 初始灵魂提示词计数器标识。 */
  tokenCounter: string
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
export interface ReplaceSourceRecord extends SourceWriteRecord { }

/** 仓储返回的人物分页记录。 */
export interface PersonaPageRecord {
  /** 当前页人物。 */
  items: PersonaRecord[]
  /** 全部人物数量。 */
  total: number
  /** 已按总数修正的当前页码。 */
  page: number
  /** 每页数量。 */
  pageSize: 5 | 10 | 20 | 50 | 100
  /** 总页数；空列表时仍为 1。 */
  totalPages: number
}

/** 仓储返回的世界分页记录。 */
export interface WorldPageRecord {
  /** 当前页世界。 */
  items: WorldRecord[]
  /** 全部世界数量。 */
  total: number
  /** 已按总数修正的当前页码。 */
  page: number
  /** 每页数量。 */
  pageSize: 5 | 10 | 20 | 50 | 100
  /** 总页数；空列表时仍为 1。 */
  totalPages: number
}

/** 仓储返回的资料分页记录。 */
export interface SourcePageRecord {
  /** 当前页资料。 */
  items: SourceMaterialRecord[]
  /** 全部资料数量。 */
  total: number
  /** 已按总数修正的当前页码。 */
  page: number
  /** 每页数量。 */
  pageSize: 5 | 10 | 20 | 50 | 100
  /** 总页数；空列表时仍为 1。 */
  totalPages: number
}

/** 仓储返回的资料段落检索记录。 */
export interface SourceChunkSearchRecord extends SourceChunkRecord {
  /** 所属资料展示名称。 */
  sourceName: string
}

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
  /** 已把该版本世界复制为运行证据的历史任务数。 */
  runs: number
}

/** 阶段二人物、世界与资料的持久化端口。 */
export interface ContentRepository {
  /** @returns 按更新时间倒序的人物。 */
  listPersonas(): Promise<PersonaRecord[]>
  /** @param page 从 1 开始的页码。 @param pageSize 每页数量。 @param query 可选人物名称筛选词。 @returns 已按总数修正的人物分页记录。 */
  listPersonasPage(page: number, pageSize: 5 | 10 | 20 | 50 | 100, query?: string, status?: 'all' | 'enabled' | 'disabled', sort?: 'name' | 'createdAt' | 'updatedAt', order?: 'asc' | 'desc'): Promise<PersonaPageRecord>
  /** @param id 人物标识。 @returns 人物或 null。 */
  findPersona(id: string): Promise<PersonaRecord | null>
  /** @param identifier 已规范化的人物用户名或邮箱。 @returns 同时匹配用户名或邮箱的人物 UUID，最多两项。 */
  findPersonaIdsByCredentialIdentifier(identifier: string): Promise<string[]>
  /** @param personaId 人物标识。 @returns 至少配置一项的账号信息密文记录，否则为 null。 */
  findPersonaCredential(personaId: string): Promise<PersonaCredentialRecord | null>
  /** @param record 完整创建命令。 @returns 无返回值。 */
  createPersona(record: CreatePersonaRecord): Promise<'created' | 'duplicate_username' | 'duplicate_email'>
  /** @param record 三项分别可空的账号信息。 @param timestamp 更新时间。 @returns 保存结果。 */
  savePersonaCredential(record: PersonaCredentialRecord, timestamp: number): Promise<'updated' | 'duplicate_username' | 'duplicate_email'>
  /** @param id 人物标识。 @param name 新名称。 @param worldId 新世界标识。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updatePersona(id: string, name: string, worldId: string | null, timestamp: number): Promise<boolean>
  /** @param personaId 人物标识。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updatePersonaStatus(personaId: string, isEnabled: boolean, timestamp: number): Promise<boolean>
  /** @param personaId 人物标识。 @param enabled 自动提炼并发布开关。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updatePersonaLearningAutomation(personaId: string, enabled: boolean, timestamp: number): Promise<boolean>
  /** @param personaIds 人物标识集合。 @param isEnabled 统一新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updatePersonasStatus(personaIds: string[], isEnabled: boolean, timestamp: number): Promise<number>
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

  /** @returns 按更新时间倒序的世界。 */
  listWorlds(): Promise<WorldRecord[]>
  /** @param page 从 1 开始的页码。 @param pageSize 每页数量。 @param query 可选世界名称筛选词。 @returns 已按总数修正的世界分页记录。 */
  listWorldsPage(page: number, pageSize: 5 | 10 | 20 | 50 | 100, query?: string, status?: 'all' | 'enabled' | 'disabled', sort?: 'name' | 'createdAt' | 'updatedAt', order?: 'asc' | 'desc'): Promise<WorldPageRecord>
  /** @param id 世界标识。 @returns 世界或 null。 */
  findWorld(id: string): Promise<WorldRecord | null>
  /** @param record 完整创建命令。 @returns 无返回值。 */
  createWorld(record: CreateWorldRecord): Promise<void>
  /** @param id 世界标识。 @param name 新名称。 @param summary 新摘要。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updateWorld(id: string, name: string, summary: string, timestamp: number): Promise<boolean>
  /** @param worldId 世界标识。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updateWorldStatus(worldId: string, isEnabled: boolean, timestamp: number): Promise<boolean>
  /** @param worldId 世界标识。 @param enabled 自动提炼并发布开关。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updateWorldLearningAutomation(worldId: string, enabled: boolean, timestamp: number): Promise<boolean>
  /** @param worldIds 世界标识集合。 @param isEnabled 统一新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updateWorldsStatus(worldIds: string[], isEnabled: boolean, timestamp: number): Promise<number>
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
  /** @param page 从 1 开始的页码。 @param pageSize 每页数量。 @param query 可选资料名称筛选词。 @returns 已按总数修正的资料分页记录。 */
  listSourcesPage(page: number, pageSize: 5 | 10 | 20 | 50 | 100, query?: string, status?: 'all' | 'enabled' | 'disabled', sort?: 'name' | 'createdAt' | 'updatedAt', order?: 'asc' | 'desc'): Promise<SourcePageRecord>
  /** @param id 资料标识。 @returns 资料或 null。 */
  findSource(id: string): Promise<SourceMaterialRecord | null>
  /** @param record 完整资料创建命令。 @returns 无返回值。 */
  createSource(record: CreateSourceRecord): Promise<void>
  /** @param record 完整资料替换命令。 @returns 是否更新成功。 */
  replaceSource(record: ReplaceSourceRecord): Promise<boolean>
  /** @param sourceId 资料标识。 @param isEnabled 新启用状态。 @param timestamp 更新时间。 @returns 是否更新成功。 */
  updateSourceStatus(sourceId: string, isEnabled: boolean, timestamp: number): Promise<boolean>
  /** @param sourceIds 资料标识集合。 @param isEnabled 统一新状态。 @param timestamp 更新时间。 @returns 更新的资料数量。 */
  updateSourcesStatus(sourceIds: string[], isEnabled: boolean, timestamp: number): Promise<number>
  /** @param sourceId 资料标识。 @returns 顺序稳定的切片。 */
  listSourceChunks(sourceId: string): Promise<SourceChunkRecord[]>
  /** @param sourceId 资料标识。 @returns 人物和世界关联。 */
  listSourceLinks(sourceId: string): Promise<SourceLinkRecord[]>
  /** @returns 当前 Account 全局资料 UUID，按优先级和 UUID 稳定排序。 */
  listGlobalSourceIds(): Promise<string[]>
  /** @param sourceId 资料标识。 @returns 是否属于当前 Account 全局资料。 */
  isGlobalSource(sourceId: string): Promise<boolean>
  /** @param sourceIds 最终全局资料 UUID 集合。 @param timestamp 更新时间。 @returns 新增和移除的差异集合。 */
  replaceGlobalSources(sourceIds: string[], timestamp: number): Promise<{ addedSourceIds: string[], removedSourceIds: string[] }>
  /** @param sourceId 资料标识。 @param targetType 目标类型。 @param targetId 目标标识。 @param priority 优先级。 @returns 无返回值。 */
  linkSource(sourceId: string, targetType: 'persona' | 'world', targetId: string, priority: number): Promise<void>
  /** @param sourceId 资料标识。 @param linkId 复合关联标识。 @returns 删除的关联数。 */
  unlinkSource(sourceId: string, linkId: string): Promise<number>
  /** @param sourceId 资料标识。 @param timestamp 删除时间。 @returns 删除的资料数。 */
  deleteSource(sourceId: string, timestamp: number): Promise<number>
  /** @param query FTS5 检索词。 @param limit 最大结果数。 @returns 已复制正文与哈希的证据候选。 */
  searchSourceChunks(query: string, limit: number): Promise<SourceChunkSearchRecord[]>
}
