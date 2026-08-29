import type {
  CreatePersonaInput,
  CreatePersonaVersionInput,
  CreateSourceInput,
  CreateSourceLinkInput,
  CreateWorldInput,
  CreateWorldVersionInput,
  UpdatePersonaInput,
  UpdateSourceInput,
  UpdateWorldInput,
} from '../../../shared/schemas/content'
import type {
  DeletionImpact,
  PersonaDetails,
  PersonaSummary,
  PersonaVersionView,
  SourceChunkView,
  SourceDetails,
  SourceSummary,
  VersionFieldDiff,
  WorldDetails,
  WorldSummary,
  WorldVersionView,
} from '../../../shared/types/content'
import type {
  PersonaRecord,
  PersonaSnapshot,
  PersonaVersionRecord,
  SourceMaterialRecord,
  WorldRecord,
  WorldSnapshot,
  WorldVersionRecord,
} from '../../domain/content/ContentModels'
import { SourceContentError } from '../../domain/content/SourceContentError'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { ImageAssetStorage } from '../../ports/ImageAssetStorage'
import type { DecodedSourceFile, SourceContentProcessor, SourceFileStorage } from '../../ports/SourceContentPorts'
import { ApplicationError } from '../errors/ApplicationError'

/** 文件资料导入命令。 */
export interface ImportSourceFileInput {
  /** 用户填写的资料名称。 */
  name: string
  /** 资料业务角色。 */
  role: 'canon_fact' | 'reference' | 'style_sample'
  /** 浏览器提供的原始文件名。 */
  fileName: string
  /** 浏览器提供的媒体类型。 */
  mediaType?: string
  /** 文件原始字节。 */
  bytes: Uint8Array
}

/** 内容应用服务的全部外部依赖。 */
export interface ContentApplicationServiceDependencies {
  /** 内容事实源端口。 */
  repository: ContentRepository
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 资料正文处理端口。 */
  sourceProcessor: SourceContentProcessor
  /** 原始资料文件存储端口。 */
  sourceFiles: SourceFileStorage
  /** 可选阶段四运行资产清理端口。 */
  imageAssets?: Pick<ImageAssetStorage, 'deleteRunAssets'>
  /** OpenViking 启用时提供的持久增量同步队列；关闭时不注入。 */
  contextSyncQueue?: ContextSyncTaskQueue
}

/** 编排人物、世界、不可变版本、资料及证据检索用例。 */
export class ContentApplicationService {
  /**
   * 创建内容应用服务。
   * @param dependencies 数据、标识、时间、正文处理和文件端口。
   */
  constructor(private readonly dependencies: ContentApplicationServiceDependencies) {}

  /**
   * 查询全部人物摘要。
   * @returns 按更新时间倒序的人物列表。
   */
  async listPersonas(): Promise<PersonaSummary[]> {
    const personas = await this.dependencies.repository.listPersonas()
    return await Promise.all(personas.map(persona => this.toPersonaSummary(persona)))
  }

  /**
   * 查询单个人物、版本和资料。
   * @param personaId 人物 UUID。
   * @returns 可供管理界面直接使用的人物详情。
   */
  async getPersona(personaId: string): Promise<PersonaDetails> {
    const persona = await this.requirePersona(personaId)
    const versions = await this.dependencies.repository.listPersonaVersions(personaId)
    const sources = await this.dependencies.repository.listPersonaSources(personaId)
    return {
      persona: await this.toPersonaSummary(persona, versions, sources),
      versions,
      sources: await Promise.all(sources.map(source => this.toSourceSummary(source))),
    }
  }

  /**
   * 创建人物、初始候选版本和可选资料关联。
   * @param input 已通过共享 Schema 校验的输入。
   * @returns 新人物详情。
   */
  async createPersona(input: CreatePersonaInput): Promise<PersonaDetails> {
    const sourceIds = [...new Set(input.sourceIds)]
    if (input.origin === 'source_based' && sourceIds.length === 0) {
      throw new ApplicationError('SOURCE_REQUIRED', '资料型人物至少需要关联一项资料', 422)
    }
    await this.requireOptionalWorld(input.worldId ?? null)
    await this.requireSources(sourceIds)

    const personaId = this.dependencies.identifiers.create()
    await this.dependencies.repository.createPersona({
      id: personaId,
      versionId: this.dependencies.identifiers.create(),
      worldId: input.worldId ?? null,
      name: input.name,
      origin: input.origin,
      snapshot: input.snapshot,
      changeSummary: input.changeSummary,
      sourceIds,
      timestamp: this.dependencies.clock.now(),
    })
    return await this.getPersona(personaId)
  }

  /**
   * 只修改人物名称和可选世界指针，不触碰版本快照。
   * @param personaId 人物 UUID。
   * @param input 已校验元数据。
   * @returns 更新后人物详情。
   */
  async updatePersona(personaId: string, input: UpdatePersonaInput): Promise<PersonaDetails> {
    await this.requirePersona(personaId)
    await this.requireOptionalWorld(input.worldId)
    await this.dependencies.repository.updatePersona(personaId, input.name, input.worldId, this.dependencies.clock.now())
    return await this.getPersona(personaId)
  }

  /**
   * 从明确基础版本派生新的不可变候选版本。
   * @param personaId 人物 UUID。
   * @param input 基础版本、快照和变化摘要。
   * @returns 新候选版本。
   */
  async createPersonaVersion(personaId: string, input: CreatePersonaVersionInput): Promise<PersonaVersionView> {
    const persona = await this.requirePersona(personaId)
    const baseVersion = await this.requirePersonaBaseVersion(persona, input.baseVersionId)
    const version: PersonaVersionRecord = {
      id: this.dependencies.identifiers.create(),
      personaId,
      parentVersionId: baseVersion.id,
      status: 'candidate',
      snapshot: input.snapshot,
      changeSummary: input.changeSummary,
      publishedAt: null,
      createdAt: this.dependencies.clock.now(),
    }
    await this.dependencies.repository.createPersonaVersion(version)
    return version
  }

  /**
   * 发布候选人物版本并原子切换当前版本指针。
   * @param versionId 候选版本 UUID。
   * @returns 发布后版本。
   */
  async publishPersonaVersion(versionId: string): Promise<PersonaVersionView> {
    const version = await this.requirePersonaVersion(versionId)
    if (version.status !== 'candidate') {
      throw new ApplicationError('VERSION_CONFLICT', '只有候选版本可以发布', 409)
    }
    const timestamp = this.dependencies.clock.now()
    const published = await this.dependencies.repository.publishPersonaVersion(version.personaId, version.id, timestamp)
    if (!published) {
      throw new ApplicationError('VERSION_CONFLICT', '版本状态已经变化，请刷新后重试', 409)
    }
    return { ...version, status: 'published', publishedAt: timestamp }
  }

  /**
   * 把人物当前指针切回指定历史已发布版本，不修改任何版本内容。
   * @param personaId 人物 UUID。
   * @param versionId 已发布版本 UUID。
   * @returns 回滚后人物详情。
   */
  async rollbackPersona(personaId: string, versionId: string): Promise<PersonaDetails> {
    await this.requirePersona(personaId)
    const changed = await this.dependencies.repository.rollbackPersona(personaId, versionId, this.dependencies.clock.now())
    if (!changed) {
      throw new ApplicationError('VERSION_CONFLICT', '目标版本不属于该人物或尚未发布', 409)
    }
    return await this.getPersona(personaId)
  }

  /**
   * 比较两个同人物版本的档案字段。
   * @param baseVersionId 基础版本 UUID。
   * @param targetVersionId 目标版本 UUID。
   * @returns 仅包含变化字段的差异列表。
   */
  async comparePersonaVersions(baseVersionId: string, targetVersionId: string): Promise<VersionFieldDiff[]> {
    const [base, target] = await Promise.all([
      this.requirePersonaVersion(baseVersionId),
      this.requirePersonaVersion(targetVersionId),
    ])
    if (base.personaId !== target.personaId) {
      throw new ApplicationError('VERSION_CONFLICT', '只能比较同一人物的版本', 409)
    }
    return diffPersonaSnapshots(base.snapshot, target.snapshot)
  }

  /**
   * 返回删除人物会级联移除的版本和解除的资料关系。
   * @param personaId 人物 UUID。
   * @returns 可删除的明确影响范围。
   */
  async getPersonaDeletionImpact(personaId: string): Promise<DeletionImpact> {
    await this.requirePersona(personaId)
    const [versions, sources, runHistory, runIds] = await Promise.all([
      this.dependencies.repository.listPersonaVersions(personaId),
      this.dependencies.repository.listPersonaSources(personaId),
      this.dependencies.repository.getPersonaRunHistoryStatistics(personaId),
      this.dependencies.repository.listPersonaRunIds(personaId),
    ])
    return {
      resourceType: 'persona',
      resourceId: personaId,
      canDelete: true,
      blockers: [],
      relatedPersonas: [],
      relatedWorlds: [],
      relatedSources: sources.map(source => ({ id: source.id, name: source.name })),
      versionCount: versions.length,
      runHistory,
      files: runIds.map(runId => `artifacts/${runId}`),
    }
  }

  /**
   * 永久删除人物、其版本和关联关系，不删除共享世界或资料。
   * @param personaId 人物 UUID。
   * @returns 无返回值。
   */
  async deletePersona(personaId: string): Promise<void> {
    await this.requirePersona(personaId)
    const runIds = await this.dependencies.repository.listPersonaRunIds(personaId)
    await this.dependencies.repository.deletePersona(personaId)
    if (this.dependencies.imageAssets) await this.dependencies.imageAssets.deleteRunAssets(runIds)
  }

  /**
   * 查询全部世界设定摘要。
   * @returns 按更新时间倒序的世界列表。
   */
  async listWorlds(): Promise<WorldSummary[]> {
    const worlds = await this.dependencies.repository.listWorlds()
    return await Promise.all(worlds.map(world => this.toWorldSummary(world)))
  }

  /**
   * 查询世界、版本、人物和资料。
   * @param worldId 世界 UUID。
   * @returns 世界详情。
   */
  async getWorld(worldId: string): Promise<WorldDetails> {
    const world = await this.requireWorld(worldId)
    const [versions, personas, sources] = await Promise.all([
      this.dependencies.repository.listWorldVersions(worldId),
      this.dependencies.repository.listWorldPersonas(worldId),
      this.dependencies.repository.listWorldSources(worldId),
    ])
    return {
      world: await this.toWorldSummary(world, versions, personas, sources),
      versions,
      personas: await Promise.all(personas.map(persona => this.toPersonaSummary(persona))),
      sources: await Promise.all(sources.map(source => this.toSourceSummary(source))),
    }
  }

  /**
   * 创建世界设定和初始候选版本。
   * @param input 已校验世界输入。
   * @returns 新世界详情。
   */
  async createWorld(input: CreateWorldInput): Promise<WorldDetails> {
    const worldId = this.dependencies.identifiers.create()
    await this.dependencies.repository.createWorld({
      id: worldId,
      versionId: this.dependencies.identifiers.create(),
      name: input.name,
      summary: input.summary,
      snapshot: input.snapshot,
      changeSummary: input.changeSummary,
      timestamp: this.dependencies.clock.now(),
    })
    return await this.getWorld(worldId)
  }

  /**
   * 修改世界名称和摘要，不修改不可变正文版本。
   * @param worldId 世界 UUID。
   * @param input 已校验元数据。
   * @returns 更新后的世界详情。
   */
  async updateWorld(worldId: string, input: UpdateWorldInput): Promise<WorldDetails> {
    await this.requireWorld(worldId)
    await this.dependencies.repository.updateWorld(worldId, input.name, input.summary, this.dependencies.clock.now())
    return await this.getWorld(worldId)
  }

  /**
   * 从明确基础版本派生世界候选版本。
   * @param worldId 世界 UUID。
   * @param input 基础版本、正文快照和变化摘要。
   * @returns 新候选版本。
   */
  async createWorldVersion(worldId: string, input: CreateWorldVersionInput): Promise<WorldVersionView> {
    const world = await this.requireWorld(worldId)
    const baseVersion = await this.requireWorldBaseVersion(world, input.baseVersionId)
    const version: WorldVersionRecord = {
      id: this.dependencies.identifiers.create(),
      worldId,
      parentVersionId: baseVersion.id,
      status: 'candidate',
      snapshot: input.snapshot,
      changeSummary: input.changeSummary,
      publishedAt: null,
      createdAt: this.dependencies.clock.now(),
    }
    await this.dependencies.repository.createWorldVersion(version)
    return version
  }

  /**
   * 发布世界候选版本并原子切换当前指针。
   * @param versionId 候选版本 UUID。
   * @returns 发布后的版本。
   */
  async publishWorldVersion(versionId: string): Promise<WorldVersionView> {
    const version = await this.requireWorldVersion(versionId)
    if (version.status !== 'candidate') {
      throw new ApplicationError('VERSION_CONFLICT', '只有候选版本可以发布', 409)
    }
    const timestamp = this.dependencies.clock.now()
    const published = await this.dependencies.repository.publishWorldVersion(version.worldId, version.id, timestamp)
    if (!published) {
      throw new ApplicationError('VERSION_CONFLICT', '版本状态已经变化，请刷新后重试', 409)
    }
    return { ...version, status: 'published', publishedAt: timestamp }
  }

  /**
   * 把世界当前指针切回历史已发布版本。
   * @param worldId 世界 UUID。
   * @param versionId 已发布版本 UUID。
   * @returns 回滚后的世界详情。
   */
  async rollbackWorld(worldId: string, versionId: string): Promise<WorldDetails> {
    await this.requireWorld(worldId)
    const changed = await this.dependencies.repository.rollbackWorld(worldId, versionId, this.dependencies.clock.now())
    if (!changed) {
      throw new ApplicationError('VERSION_CONFLICT', '目标版本不属于该世界或尚未发布', 409)
    }
    return await this.getWorld(worldId)
  }

  /**
   * 比较两个同世界版本的正文。
   * @param baseVersionId 基础版本 UUID。
   * @param targetVersionId 目标版本 UUID。
   * @returns 正文变化；相同时返回空数组。
   */
  async compareWorldVersions(baseVersionId: string, targetVersionId: string): Promise<VersionFieldDiff[]> {
    const [base, target] = await Promise.all([
      this.requireWorldVersion(baseVersionId),
      this.requireWorldVersion(targetVersionId),
    ])
    if (base.worldId !== target.worldId) {
      throw new ApplicationError('VERSION_CONFLICT', '只能比较同一世界的版本', 409)
    }
    return base.snapshot.content === target.snapshot.content
      ? []
      : [{ field: 'content', label: '世界正文', before: base.snapshot.content, after: target.snapshot.content }]
  }

  /**
   * 分析世界删除影响；仍有人物关联时明确阻止删除。
   * @param worldId 世界 UUID。
   * @returns 人物阻断项、资料关系和版本数。
   */
  async getWorldDeletionImpact(worldId: string): Promise<DeletionImpact> {
    await this.requireWorld(worldId)
    const [versions, personas, sources] = await Promise.all([
      this.dependencies.repository.listWorldVersions(worldId),
      this.dependencies.repository.listWorldPersonas(worldId),
      this.dependencies.repository.listWorldSources(worldId),
    ])
    return {
      resourceType: 'world',
      resourceId: worldId,
      canDelete: personas.length === 0,
      blockers: personas.length > 0 ? [`仍有 ${personas.length} 个人物关联，必须先解除世界关联`] : [],
      relatedPersonas: personas.map(persona => ({ id: persona.id, name: persona.name })),
      relatedWorlds: [],
      relatedSources: sources.map(source => ({ id: source.id, name: source.name })),
      versionCount: versions.length,
      runHistory: { runs: 0, tasks: 0, evidenceSnapshots: 0, documentSpecs: 0, artifactBlocks: 0, blockAttempts: 0 },
      files: [],
    }
  }

  /**
   * 永久删除无人物关联的世界、其版本和资料关联。
   * @param worldId 世界 UUID。
   * @returns 无返回值。
   */
  async deleteWorld(worldId: string): Promise<void> {
    const impact = await this.getWorldDeletionImpact(worldId)
    if (!impact.canDelete) {
      throw new ApplicationError('RESOURCE_IN_USE', impact.blockers[0]!, 409, { impact })
    }
    await this.dependencies.repository.deleteWorld(worldId)
  }

  /**
   * 查询全部资料摘要。
   * @returns 按更新时间倒序的资料列表。
   */
  async listSources(): Promise<SourceSummary[]> {
    const sources = await this.dependencies.repository.listSources()
    return await Promise.all(sources.map(source => this.toSourceSummary(source)))
  }

  /**
   * 查询资料正文、切片和全部关联。
   * @param sourceId 资料 UUID。
   * @returns 资料详情。
   */
  async getSource(sourceId: string): Promise<SourceDetails> {
    const source = await this.requireSource(sourceId)
    const [chunks, links] = await Promise.all([
      this.dependencies.repository.listSourceChunks(sourceId),
      this.dependencies.repository.listSourceLinks(sourceId),
    ])
    return {
      source: await this.toSourceSummary(source, chunks.length, links.length),
      chunks,
      links,
    }
  }

  /**
   * 创建粘贴文本资料并立即生成 FTS5 切片。
   * @param input 已校验资料输入。
   * @returns 新资料详情。
   */
  async createPastedSource(input: CreateSourceInput): Promise<SourceDetails> {
    const sourceId = this.dependencies.identifiers.create()
    const content = this.normalizeSource(input.content)
    const timestamp = this.dependencies.clock.now()
    await this.dependencies.repository.createSource({
      id: sourceId,
      name: input.name,
      role: input.role,
      inputType: 'paste',
      contentHash: this.dependencies.sourceProcessor.hash(content),
      contentText: content,
      originalFilePath: null,
      chunks: this.dependencies.sourceProcessor.chunk(sourceId, content),
      timestamp,
    })
    await this.enqueueSourceSynchronization(sourceId)
    return await this.getSource(sourceId)
  }

  /**
   * 安全导入 TXT 或 Markdown，先落文件，再落数据库；数据库失败时清理本次文件。
   * @param input 文件元数据与原始字节。
   * @returns 新资料详情。
   */
  async importSourceFile(input: ImportSourceFileInput): Promise<SourceDetails> {
    const sourceId = this.dependencies.identifiers.create()
    const decoded = this.decodeSourceFile(input)
    const relativePath = await this.dependencies.sourceFiles.save(sourceId, decoded.extension, input.bytes)
    try {
      await this.dependencies.repository.createSource({
        id: sourceId,
        name: input.name,
        role: input.role,
        inputType: decoded.inputType,
        contentHash: this.dependencies.sourceProcessor.hash(decoded.content),
        contentText: decoded.content,
        originalFilePath: relativePath,
        chunks: this.dependencies.sourceProcessor.chunk(sourceId, decoded.content),
        timestamp: this.dependencies.clock.now(),
      })
    }
    catch (error: unknown) {
      await this.dependencies.sourceFiles.delete(relativePath)
      throw error
    }
    await this.enqueueSourceSynchronization(sourceId)
    return await this.getSource(sourceId)
  }

  /**
   * 更新资料正文时重建全部切片；编辑导入正文会转为粘贴文本并删除旧原文件。
   * @param sourceId 资料 UUID。
   * @param input 已校验的新元数据和正文。
   * @returns 更新后的资料详情。
   */
  async updateSource(sourceId: string, input: UpdateSourceInput): Promise<SourceDetails> {
    const current = await this.requireSource(sourceId)
    const content = this.normalizeSource(input.content)
    const contentChanged = content !== current.contentText
    const originalFilePath = contentChanged ? null : current.originalFilePath
    const inputType = contentChanged ? 'paste' : current.inputType
    await this.dependencies.repository.replaceSource({
      id: sourceId,
      name: input.name,
      role: input.role,
      inputType,
      contentHash: this.dependencies.sourceProcessor.hash(content),
      contentText: content,
      originalFilePath,
      chunks: this.dependencies.sourceProcessor.chunk(sourceId, content),
      timestamp: this.dependencies.clock.now(),
    })
    if (contentChanged && current.originalFilePath) {
      await this.dependencies.sourceFiles.delete(current.originalFilePath)
    }
    await this.enqueueSourceSynchronization(sourceId)
    return await this.getSource(sourceId)
  }

  /**
   * 仅在组合根启用 OpenViking 时创建持久同步任务，不在资料请求中联网。
   * @param sourceId 已成功保存的资料 UUID。
   * @returns 排队完成时结束；能力关闭时直接结束。
   */
  private async enqueueSourceSynchronization(sourceId: string): Promise<void> {
    if (!this.dependencies.contextSyncQueue) return
    await this.dependencies.contextSyncQueue.enqueueSourceSynchronization(
      sourceId,
      this.dependencies.identifiers.create(),
      this.dependencies.clock.now(),
    )
  }

  /**
   * 建立或更新资料与人物/世界关联。
   * @param sourceId 资料 UUID。
   * @param input 目标和优先级。
   * @returns 更新后的资料详情。
   */
  async linkSource(sourceId: string, input: CreateSourceLinkInput): Promise<SourceDetails> {
    await this.requireSource(sourceId)
    if (input.targetType === 'persona') {
      await this.requirePersona(input.targetId)
    }
    else {
      await this.requireWorld(input.targetId)
    }
    await this.dependencies.repository.linkSource(sourceId, input.targetType, input.targetId, input.priority)
    return await this.getSource(sourceId)
  }

  /**
   * 解除一项资料关联，不删除任何聚合根。
   * @param sourceId 资料 UUID。
   * @param linkId 接口返回的复合关联标识。
   * @returns 更新后的资料详情。
   */
  async unlinkSource(sourceId: string, linkId: string): Promise<SourceDetails> {
    await this.requireSource(sourceId)
    const removed = await this.dependencies.repository.unlinkSource(sourceId, linkId)
    if (removed !== 1) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '资料关联不存在', 404)
    }
    return await this.getSource(sourceId)
  }

  /**
   * 返回资料删除的关联阻断项和原始文件路径。
   * @param sourceId 资料 UUID。
   * @returns 明确影响范围。
   */
  async getSourceDeletionImpact(sourceId: string): Promise<DeletionImpact> {
    const source = await this.requireSource(sourceId)
    const links = await this.dependencies.repository.listSourceLinks(sourceId)
    return {
      resourceType: 'source',
      resourceId: sourceId,
      canDelete: links.length === 0,
      blockers: links.length > 0 ? [`仍有 ${links.length} 项人物或世界关联，必须先解除关联`] : [],
      relatedPersonas: links
        .filter(link => link.targetType === 'persona')
        .map(link => ({ id: link.targetId, name: link.targetName })),
      relatedWorlds: links
        .filter(link => link.targetType === 'world')
        .map(link => ({ id: link.targetId, name: link.targetName })),
      relatedSources: [],
      versionCount: 0,
      runHistory: { runs: 0, tasks: 0, evidenceSnapshots: 0, documentSpecs: 0, artifactBlocks: 0, blockAttempts: 0 },
      files: source.originalFilePath ? [source.originalFilePath] : [],
    }
  }

  /**
   * 永久删除无关联资料、切片、FTS 索引和原始文件。
   * @param sourceId 资料 UUID。
   * @returns 无返回值。
   */
  async deleteSource(sourceId: string): Promise<void> {
    const source = await this.requireSource(sourceId)
    const impact = await this.getSourceDeletionImpact(sourceId)
    if (!impact.canDelete) {
      throw new ApplicationError('RESOURCE_IN_USE', impact.blockers[0]!, 409, { impact })
    }
    await this.dependencies.repository.deleteSource(sourceId)
    if (source.originalFilePath) {
      await this.dependencies.sourceFiles.delete(source.originalFilePath)
    }
  }

  /**
   * 使用 SQLite FTS5 检索资料切片。
   * @param query 已校验非空检索短语。
   * @param limit 最大结果数。
   * @returns 含正文与哈希的证据候选，后续运行可原样复制为快照。
   */
  async searchSources(query: string, limit: number): Promise<SourceChunkView[]> {
    return await this.dependencies.repository.searchSourceChunks(query, limit)
  }

  /** @param id 人物 UUID。 @returns 存在的人物。 @throws ApplicationError 不存在时抛出。 */
  private async requirePersona(id: string): Promise<PersonaRecord> {
    const persona = await this.dependencies.repository.findPersona(id)
    if (!persona) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '人物不存在', 404)
    }
    return persona
  }

  /** @param id 世界 UUID 或 null。 @returns 无返回值。 @throws ApplicationError 非空世界不存在时抛出。 */
  private async requireOptionalWorld(id: string | null): Promise<void> {
    if (id !== null) {
      await this.requireWorld(id)
    }
  }

  /** @param id 世界 UUID。 @returns 存在的世界。 @throws ApplicationError 不存在时抛出。 */
  private async requireWorld(id: string): Promise<WorldRecord> {
    const world = await this.dependencies.repository.findWorld(id)
    if (!world) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '世界设定不存在', 404)
    }
    return world
  }

  /** @param id 资料 UUID。 @returns 存在的资料。 @throws ApplicationError 不存在时抛出。 */
  private async requireSource(id: string): Promise<SourceMaterialRecord> {
    const source = await this.dependencies.repository.findSource(id)
    if (!source) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '资料不存在', 404)
    }
    return source
  }

  /** @param ids 去重后的资料 UUID。 @returns 无返回值。 @throws ApplicationError 任一资料不存在时抛出。 */
  private async requireSources(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.requireSource(id)
    }
  }

  /** @param id 人物版本 UUID。 @returns 存在的版本。 @throws ApplicationError 不存在时抛出。 */
  private async requirePersonaVersion(id: string): Promise<PersonaVersionRecord> {
    const version = await this.dependencies.repository.findPersonaVersion(id)
    if (!version) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '人物版本不存在', 404)
    }
    return version
  }

  /** @param id 世界版本 UUID。 @returns 存在的版本。 @throws ApplicationError 不存在时抛出。 */
  private async requireWorldVersion(id: string): Promise<WorldVersionRecord> {
    const version = await this.dependencies.repository.findWorldVersion(id)
    if (!version) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '世界版本不存在', 404)
    }
    return version
  }

  /**
   * 验证基础版本明确存在且属于目标人物。
   * @param persona 目标人物。
   * @param baseVersionId 用户明确选择的基础版本 UUID 或 null。
   * @returns 合法基础版本。
   */
  private async requirePersonaBaseVersion(persona: PersonaRecord, baseVersionId: string | null): Promise<PersonaVersionRecord> {
    if (!baseVersionId) {
      throw new ApplicationError('VERSION_CONFLICT', '创建候选版本必须明确选择基础版本', 409)
    }
    const version = await this.requirePersonaVersion(baseVersionId)
    if (version.personaId !== persona.id || version.status === 'rejected') {
      throw new ApplicationError('VERSION_CONFLICT', '基础版本不属于该人物或已被拒绝', 409)
    }
    return version
  }

  /**
   * 验证基础版本明确存在且属于目标世界。
   * @param world 目标世界。
   * @param baseVersionId 用户明确选择的基础版本 UUID 或 null。
   * @returns 合法基础版本。
   */
  private async requireWorldBaseVersion(world: WorldRecord, baseVersionId: string | null): Promise<WorldVersionRecord> {
    if (!baseVersionId) {
      throw new ApplicationError('VERSION_CONFLICT', '创建候选版本必须明确选择基础版本', 409)
    }
    const version = await this.requireWorldVersion(baseVersionId)
    if (version.worldId !== world.id || version.status === 'rejected') {
      throw new ApplicationError('VERSION_CONFLICT', '基础版本不属于该世界或已被拒绝', 409)
    }
    return version
  }

  /**
   * 组装人物列表摘要，并复用调用方已经读取的数据避免重复查询。
   * @param persona 人物记录。
   * @param knownVersions 可选版本集合。
   * @param knownSources 可选资料集合。
   * @returns 人物摘要。
   */
  private async toPersonaSummary(
    persona: PersonaRecord,
    knownVersions?: PersonaVersionRecord[],
    knownSources?: SourceMaterialRecord[],
  ): Promise<PersonaSummary> {
    const versions = knownVersions ?? await this.dependencies.repository.listPersonaVersions(persona.id)
    const sources = knownSources ?? await this.dependencies.repository.listPersonaSources(persona.id)
    const active = versions.find(version => version.id === persona.activeVersionId)
    const world = persona.worldId ? await this.dependencies.repository.findWorld(persona.worldId) : null
    return {
      ...persona,
      worldName: world?.name ?? null,
      currentSummary: active?.snapshot.summary ?? null,
      versionCount: versions.length,
      sourceCount: sources.length,
    }
  }

  /**
   * 组装世界列表摘要，并复用调用方已经读取的数据避免重复查询。
   * @param world 世界记录。
   * @param knownVersions 可选版本集合。
   * @param knownPersonas 可选人物集合。
   * @param knownSources 可选资料集合。
   * @returns 世界摘要。
   */
  private async toWorldSummary(
    world: WorldRecord,
    knownVersions?: WorldVersionRecord[],
    knownPersonas?: PersonaRecord[],
    knownSources?: SourceMaterialRecord[],
  ): Promise<WorldSummary> {
    const versions = knownVersions ?? await this.dependencies.repository.listWorldVersions(world.id)
    const personas = knownPersonas ?? await this.dependencies.repository.listWorldPersonas(world.id)
    const sources = knownSources ?? await this.dependencies.repository.listWorldSources(world.id)
    const active = versions.find(version => version.id === world.activeVersionId)
    return {
      ...world,
      currentContent: active?.snapshot.content ?? null,
      versionCount: versions.length,
      personaCount: personas.length,
      sourceCount: sources.length,
    }
  }

  /**
   * 组装资料摘要。
   * @param source 资料记录。
   * @param knownChunkCount 可选切片数。
   * @param knownLinkCount 可选关联数。
   * @returns 资料摘要。
   */
  private async toSourceSummary(
    source: SourceMaterialRecord,
    knownChunkCount?: number,
    knownLinkCount?: number,
  ): Promise<SourceSummary> {
    const chunks = knownChunkCount ?? (await this.dependencies.repository.listSourceChunks(source.id)).length
    const links = knownLinkCount ?? (await this.dependencies.repository.listSourceLinks(source.id)).length
    return { ...source, chunkCount: chunks, linkCount: links }
  }

  /** @param content 原始资料正文。 @returns 规范化正文。 @throws ApplicationError 输入不安全时抛出。 */
  private normalizeSource(content: string): string {
    try {
      return this.dependencies.sourceProcessor.normalizeText(content)
    }
    catch (error: unknown) {
      if (error instanceof SourceContentError) {
        throw new ApplicationError('VALIDATION_FAILED', error.message, 400)
      }
      throw error
    }
  }

  /** @param input 文件导入命令。 @returns 已安全解码的文件。 @throws ApplicationError 文件无效时抛出。 */
  private decodeSourceFile(input: ImportSourceFileInput): DecodedSourceFile {
    try {
      return this.dependencies.sourceProcessor.decodeFile(input.fileName, input.mediaType, input.bytes)
    }
    catch (error: unknown) {
      if (error instanceof SourceContentError) {
        throw new ApplicationError('VALIDATION_FAILED', error.message, 400)
      }
      throw error
    }
  }
}

/** 人物快照字段的中文标签。 */
const PERSONA_FIELD_LABELS: Record<keyof PersonaSnapshot, string> = {
  summary: '人物定位',
  identityFacts: '身份事实',
  interests: '兴趣偏好',
  valuesAndMotivations: '价值与动机',
  expressionStyle: '表达风格',
  appearance: '外观描述',
  visualStyle: '视觉风格',
  constraints: '约束',
}

/**
 * 生成两个人物快照的字段级差异。
 * @param before 基础快照。
 * @param after 目标快照。
 * @returns 仅含变化字段的稳定顺序列表。
 */
function diffPersonaSnapshots(before: PersonaSnapshot, after: PersonaSnapshot): VersionFieldDiff[] {
  return (Object.keys(PERSONA_FIELD_LABELS) as Array<keyof PersonaSnapshot>)
    .filter(field => before[field] !== after[field])
    .map(field => ({
      field,
      label: PERSONA_FIELD_LABELS[field],
      before: before[field],
      after: after[field],
    }))
}
