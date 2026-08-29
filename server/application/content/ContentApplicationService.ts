import type {
  CreatePersonaInput,
  CreateSourceInput,
  CreateSourceLinkInput,
  ListSubjectsPageInput,
  ListSourcesPageInput,
  SourceCreationTarget,
  CreateWorldInput,
  UpdatePersonaInput,
  UpdatePersonaStatusInput,
  UpdatePersonasStatusInput,
  UpdateSourceInput,
  UpdateSourceStatusInput,
  UpdateSourcesStatusInput,
  UpdateWorldInput,
  UpdateWorldStatusInput,
  UpdateWorldsStatusInput,
} from '../../../shared/schemas/content'
import type {
  DeletionImpact,
  PersonaDetails,
  PersonaPageView,
  PersonaStatusUpdateResult,
  PersonaSummary,
  SourceChunkView,
  SourceDetails,
  SourcePageView,
  SourceStatusUpdateResult,
  SourceSummary,
  VersionFieldDiff,
  WorldDetails,
  WorldPageView,
  WorldSummary,
  WorldStatusUpdateResult,
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
import type { SoulRepository } from '../../ports/SoulRepository'
import { SourceContentError } from '../../domain/content/SourceContentError'
import { normalizeSoulSnapshot } from '../../domain/content/SoulRules'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository, SourceCreationLinkRecord } from '../../ports/ContentRepository'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { ImageAssetStorage } from '../../ports/ImageAssetStorage'
import type { DecodedSourceFile, SourceContentProcessor, SourceFileStorage } from '../../ports/SourceContentPorts'
import { StorageCapacityError } from '../../ports/StorageCapacity'
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
  /** 创建资料时同时建立的可选人物和世界关联。 */
  targets?: SourceCreationTarget[]
}

/** 应用服务接受的粘贴资料创建命令，兼容未指定关联的内部调用。 */
export type CreatePastedSourceInput = CreateSourceInput & {
  /** 创建资料时同时建立的可选人物和世界关联。 */
  targets?: SourceCreationTarget[]
}

/** 内容应用服务的全部外部依赖。 */
export interface ContentApplicationServiceDependencies {
  /** 内容事实源端口。 */
  repository: ContentRepository
  /** 灵魂草稿与版本事实源，只供内容详情聚合读取。 */
  souls: SoulRepository
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
  /** OpenViking 启用时提供的持久资料同步与删除队列；关闭时不注入。 */
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
   * 分页查询人物摘要，限制管理列表单次加载量。
   * @param input 已校验的页码和每页数量。
   * @returns 服务端修正页码后的人物分页结果。
   */
  async listPersonasPage(input: ListSubjectsPageInput): Promise<PersonaPageView> {
    const page = await this.dependencies.repository.listPersonasPage(input.page, input.pageSize)
    return {
      ...page,
      items: await Promise.all(page.items.map(persona => this.toPersonaSummary(persona))),
    }
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
      draft: await this.dependencies.souls.findSoulDraft('persona', personaId),
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
      draftId: this.dependencies.identifiers.create(),
      worldId: input.worldId ?? null,
      name: input.name,
      origin: input.origin,
      snapshot: normalizeSoulSnapshot(input.snapshot),
      changeSummary: input.changeSummary,
      sourceIds,
      timestamp: this.dependencies.clock.now(),
    })
    await this.enqueueSourceSynchronizations(sourceIds)
    return await this.getPersona(personaId)
  }

  /**
   * 只修改人物名称和可选世界指针，不触碰版本快照。
   * @param personaId 人物 UUID。
   * @param input 已校验元数据。
   * @returns 更新后人物详情。
   */
  async updatePersona(personaId: string, input: UpdatePersonaInput): Promise<PersonaDetails> {
    const persona = await this.requirePersona(personaId)
    await this.requireOptionalWorld(input.worldId)
    const sources = persona.worldId === input.worldId
      ? []
      : await this.dependencies.repository.listPersonaSources(personaId)
    await this.dependencies.repository.updatePersona(personaId, input.name, input.worldId, this.dependencies.clock.now())
    await this.enqueueSourceSynchronizations(sources.map(source => source.id))
    return await this.getPersona(personaId)
  }

  /**
   * 修改单个人物启用状态，同时保留其版本、资料、记忆和历史运行。
   * @param personaId 人物 UUID。
   * @param input 已校验的新状态。
   * @returns 更新后的人物详情。
   */
  async updatePersonaStatus(personaId: string, input: UpdatePersonaStatusInput): Promise<PersonaDetails> {
    const current = await this.requirePersona(personaId)
    if (current.isEnabled === input.isEnabled) return await this.getPersona(personaId)
    await this.dependencies.repository.updatePersonaStatus(personaId, input.isEnabled, this.dependencies.clock.now())
    return await this.getPersona(personaId)
  }

  /**
   * 验证全部人物后原子修改统一启用状态，避免部分成功。
   * @param input 已校验的人物 UUID 集合和统一状态。
   * @returns 去重后的处理对象与新状态。
   */
  async updatePersonasStatus(input: UpdatePersonasStatusInput): Promise<PersonaStatusUpdateResult> {
    const personaIds = [...new Set(input.personaIds)]
    await this.requirePersonas(personaIds)
    await this.dependencies.repository.updatePersonasStatus(personaIds, input.isEnabled, this.dependencies.clock.now())
    return { personaIds, isEnabled: input.isEnabled }
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
    return diffSoulSnapshots(base.snapshot, target.snapshot)
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
    const [runIds, sources] = await Promise.all([
      this.dependencies.repository.listPersonaRunIds(personaId),
      this.dependencies.repository.listPersonaSources(personaId),
    ])
    await this.dependencies.repository.deletePersona(personaId, this.dependencies.clock.now())
    await this.enqueueSourceSynchronizations(sources.map(source => source.id))
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
   * 分页查询世界摘要，限制管理列表单次加载量。
   * @param input 已校验的页码和每页数量。
   * @returns 服务端修正页码后的世界分页结果。
   */
  async listWorldsPage(input: ListSubjectsPageInput): Promise<WorldPageView> {
    const page = await this.dependencies.repository.listWorldsPage(input.page, input.pageSize)
    return {
      ...page,
      items: await Promise.all(page.items.map(world => this.toWorldSummary(world))),
    }
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
      draft: await this.dependencies.souls.findSoulDraft('world', worldId),
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
      draftId: this.dependencies.identifiers.create(),
      name: input.name,
      summary: input.summary,
      snapshot: normalizeSoulSnapshot(input.snapshot),
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
   * 修改单个世界启用状态，同时保留其版本、资料、人物关系和历史运行。
   * @param worldId 世界 UUID。
   * @param input 已校验的新状态。
   * @returns 更新后的世界详情。
   */
  async updateWorldStatus(worldId: string, input: UpdateWorldStatusInput): Promise<WorldDetails> {
    const current = await this.requireWorld(worldId)
    if (current.isEnabled === input.isEnabled) return await this.getWorld(worldId)
    await this.dependencies.repository.updateWorldStatus(worldId, input.isEnabled, this.dependencies.clock.now())
    return await this.getWorld(worldId)
  }

  /**
   * 验证全部世界后原子修改统一启用状态，避免部分成功。
   * @param input 已校验的世界 UUID 集合和统一状态。
   * @returns 去重后的处理对象与新状态。
   */
  async updateWorldsStatus(input: UpdateWorldsStatusInput): Promise<WorldStatusUpdateResult> {
    const worldIds = [...new Set(input.worldIds)]
    await this.requireWorlds(worldIds)
    await this.dependencies.repository.updateWorldsStatus(worldIds, input.isEnabled, this.dependencies.clock.now())
    return { worldIds, isEnabled: input.isEnabled }
  }

  /**
   * 永久删除未生效、无后续修改且未被历史任务使用的世界版本。
   * @param versionId 待删除世界版本 UUID。
   * @returns 无返回值。
   */
  async deleteWorldVersion(versionId: string): Promise<void> {
    const version = await this.requireWorldVersion(versionId)
    const world = await this.requireWorld(version.worldId)
    if (world.activeVersionId === versionId) {
      throw new ApplicationError('RESOURCE_IN_USE', '当前正在使用的版本不能删除，请先启用其他已发布版本', 409)
    }
    const references = await this.dependencies.repository.getWorldVersionDeletionReferences(versionId)
    if (references.childVersions > 0) {
      throw new ApplicationError('RESOURCE_IN_USE', `还有 ${references.childVersions} 个修改版本以此版本为基础，不能删除`, 409)
    }
    if (references.runs > 0) {
      throw new ApplicationError('RESOURCE_IN_USE', `已有 ${references.runs} 次历史任务使用此版本，必须保留以便追溯`, 409)
    }
    const deleted = await this.dependencies.repository.deleteWorldVersion(versionId, this.dependencies.clock.now())
    if (deleted !== 1) {
      throw new ApplicationError('VERSION_CONFLICT', '版本状态或引用已经变化，请刷新后重试', 409)
    }
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
    return diffSoulSnapshots(base.snapshot, target.snapshot)
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
    const sources = await this.dependencies.repository.listWorldSources(worldId)
    await this.dependencies.repository.deleteWorld(worldId, this.dependencies.clock.now())
    await this.enqueueSourceSynchronizations(sources.map(source => source.id))
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
   * 分页查询资料摘要，避免资料库页面一次加载全部正文。
   * @param input 已校验的页码和每页数量。
   * @returns 服务端修正页码后的资料分页结果。
   */
  async listSourcesPage(input: ListSourcesPageInput): Promise<SourcePageView> {
    const page = await this.dependencies.repository.listSourcesPage(input.page, input.pageSize)
    return {
      ...page,
      items: await Promise.all(page.items.map(source => this.toSourceSummary(source))),
    }
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
  async createPastedSource(input: CreatePastedSourceInput): Promise<SourceDetails> {
    const sourceId = this.dependencies.identifiers.create()
    const content = this.normalizeSource(input.content)
    const timestamp = this.dependencies.clock.now()
    const links = await this.validateSourceCreationTargets(input.targets ?? [])
    await this.dependencies.repository.createSource({
      id: sourceId,
      name: input.name,
      role: input.role,
      inputType: 'paste',
      contentHash: this.dependencies.sourceProcessor.hash(content),
      contentText: content,
      originalFilePath: null,
      chunks: this.dependencies.sourceProcessor.chunk(sourceId, content),
      links,
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
    const links = await this.validateSourceCreationTargets(input.targets ?? [])
    let relativePath: string
    try {
      relativePath = await this.dependencies.sourceFiles.save(sourceId, decoded.extension, input.bytes)
    }
    catch (error: unknown) {
      if (error instanceof StorageCapacityError) throw new ApplicationError('INSUFFICIENT_STORAGE', error.message, 507)
      throw error
    }
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
        links,
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
   * 修改资料全局启用状态，并异步刷新或删除 OpenViking 投影。
   * @param sourceId 资料 UUID。
   * @param input 已校验的新状态。
   * @returns 保留正文和关系的最新资料详情。
   */
  async updateSourceStatus(sourceId: string, input: UpdateSourceStatusInput): Promise<SourceDetails> {
    const current = await this.requireSource(sourceId)
    if (current.isEnabled === input.isEnabled) return await this.getSource(sourceId)
    await this.dependencies.repository.updateSourceStatus(sourceId, input.isEnabled, this.dependencies.clock.now())
    await this.enqueueSourceSynchronization(sourceId)
    return await this.getSource(sourceId)
  }

  /**
   * 原子修改多项资料状态，再为每项资料分别创建可重试的 OpenViking 同步任务。
   * @param input 已校验的资料 UUID 集合和统一状态。
   * @returns 去重后的处理对象与新状态。
   */
  async updateSourcesStatus(input: UpdateSourcesStatusInput): Promise<SourceStatusUpdateResult> {
    const sourceIds = [...new Set(input.sourceIds)]
    await this.requireSources(sourceIds)
    await this.dependencies.repository.updateSourcesStatus(sourceIds, input.isEnabled, this.dependencies.clock.now())
    await this.enqueueSourceSynchronizations(sourceIds)
    return { sourceIds, isEnabled: input.isEnabled }
  }

  /**
   * 仅在组合根启用 OpenViking 时创建持久同步任务，不在资料请求中联网。
   * @param sourceId 已成功保存、更新或删除的资料 UUID。
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

  /** @param sourceIds 需要重新展开投影的资料 UUID。 @returns 全部持久任务创建完成时结束。 */
  private async enqueueSourceSynchronizations(sourceIds: string[]): Promise<void> {
    for (const sourceId of new Set(sourceIds)) await this.enqueueSourceSynchronization(sourceId)
  }

  /**
   * 去重并验证资料创建目标，防止无效外键导致资料或文件形成半成品。
   * @param targets 用户选择的人物和世界目标。
   * @returns 可直接交给仓储原子写入、优先级固定为 100 的关联。
   */
  private async validateSourceCreationTargets(targets: SourceCreationTarget[]): Promise<SourceCreationLinkRecord[]> {
    const uniqueTargets = [...new Map(targets.map(target => [`${target.targetType}:${target.targetId}`, target])).values()]
    await Promise.all(uniqueTargets.map(async (target) => {
      if (target.targetType === 'persona') await this.requirePersona(target.targetId)
      else await this.requireWorld(target.targetId)
    }))
    return uniqueTargets.map(target => ({ ...target, priority: 100 }))
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
    await this.enqueueSourceSynchronization(sourceId)
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
    await this.enqueueSourceSynchronization(sourceId)
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
   * 永久删除无关联资料、切片、FTS 索引和原始文件，并异步清理可选远端索引。
   * @param sourceId 资料 UUID。
   * @returns 无返回值。
   */
  async deleteSource(sourceId: string): Promise<void> {
    const source = await this.requireSource(sourceId)
    const impact = await this.getSourceDeletionImpact(sourceId)
    if (!impact.canDelete) {
      throw new ApplicationError('RESOURCE_IN_USE', impact.blockers[0]!, 409, { impact })
    }
    await this.dependencies.repository.deleteSource(sourceId, this.dependencies.clock.now())
    // 本地事实删除成功后再排队；Worker 通过资料不存在这一事实执行远端删除并负责失败重试。
    await this.enqueueSourceSynchronization(sourceId)
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

  /** @param ids 去重后的人物 UUID。 @returns 无返回值。 @throws ApplicationError 任一人物不存在时抛出。 */
  private async requirePersonas(ids: string[]): Promise<void> {
    for (const id of ids) await this.requirePersona(id)
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

  /** @param ids 去重后的世界 UUID。 @returns 无返回值。 @throws ApplicationError 任一世界不存在时抛出。 */
  private async requireWorlds(ids: string[]): Promise<void> {
    for (const id of ids) await this.requireWorld(id)
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
      currentSummary: active?.snapshot.runtimeSummary ?? null,
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
      currentContent: active?.snapshot.runtimeSummary ?? null,
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

/**
 * 生成两个灵魂快照的章节和运行摘要差异。
 * @param before 基础快照。
 * @param after 目标快照。
 * @returns 仅含变化字段的稳定顺序列表。
 */
function diffSoulSnapshots(before: PersonaSnapshot, after: PersonaSnapshot): VersionFieldDiff[] {
  const differences: VersionFieldDiff[] = []
  const beforeChapters = JSON.stringify(before.chapters)
  const afterChapters = JSON.stringify(after.chapters)
  if (beforeChapters !== afterChapters) {
    differences.push({ field: 'chapters', label: '灵魂章节', before: beforeChapters, after: afterChapters })
  }
  if (before.runtimeSummary !== after.runtimeSummary) {
    differences.push({
      field: 'runtimeSummary',
      label: '运行摘要',
      before: before.runtimeSummary,
      after: after.runtimeSummary,
    })
  }
  return differences
}
