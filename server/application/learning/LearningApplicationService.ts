import { DEFAULT_GROWTH_SCOPE } from '../../../shared/schemas/learning'
import type {
  BatchEnabledStateInput,
  BatchLearningStatusInput,
  CreateGrowthMaterialInput,
  CreateLearningPromptDraftFromVersionInput,
  CreateGrowthInput,
  CreatePersonaFeedbackSourceInput,
  DeleteGrowthInput,
  DeleteExternalRecordsInput,
  DeletePersonaFeedbackSourcesInput,
  ImportGrowthSourcesInput,
  PublishLearningPromptDraftInput,
  SaveLearningPromptDraftInput,
  SaveExternalRecordInput,
  UpdateGrowthMaterialInput,
  UpdateOperationRecordInput,
  UpdateGrowthInput,
} from '../../../shared/schemas/learning'
import type {
  PersonaFeedbackSourceView,
  PersonaGrowthWorkspaceView,
  PersonaMemoryWorkspaceView,
  GrowthLibrarySourceView,
  LearningPromptType,
  LearningPromptVersionView,
  LearningPromptWorkspaceView,
  WorldGrowthWorkspaceView,
} from '../../../shared/types/learning'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { LearningRepository } from '../../ports/LearningRepository'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { TokenCounter } from '../../ports/TokenCounter'
import type { SourceMaterialRecord } from '../../domain/content/ContentModels'
import { ApplicationError } from '../errors/ApplicationError'

/** 统一学习应用服务依赖。 */
export interface LearningApplicationServiceDependencies {
  /** 人物与世界存在性查询端口。 */
  content: Pick<ContentRepository, 'findPersona' | 'findWorld' | 'listPersonaSources' | 'listWorldSources'>
  /** 成长、处理记录和记忆事实源。 */
  learning: LearningRepository
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 发布学习提示词时使用的 Token 计数器。 */
  tokenCounter: TokenCounter
  /** 三类学习提示词各自允许的最大 Token。 */
  promptTokenBudgets: Record<LearningPromptType, number>
  /** OpenViking 启用时的人物反馈资料投影队列。 */
  contextSyncQueue?: ContextSyncTaskQueue
}

/** 编排世界成长、人物成长和人物记忆的人工管理闭环。 */
export class LearningApplicationService {
  /**
   * 创建统一学习应用服务。
   * @param dependencies 内容存在性、学习事实、标识和时间端口。
   */
  constructor(private readonly dependencies: LearningApplicationServiceDependencies) {}

  /** @param worldId 世界 UUID。 @returns 世界资料和成长完整工作区。 */
  async getWorldGrowthWorkspace(worldId: string): Promise<WorldGrowthWorkspaceView> {
    await this.requireWorld(worldId)
    const [sources, materials, prompt] = await Promise.all([
      this.dependencies.content.listWorldSources(worldId),
      this.dependencies.learning.listGrowthMaterials('world', worldId),
      this.getLearningPromptWorkspace('world_growth', worldId),
    ])
    return { sources: toGrowthLibrarySources(sources, materials), materials, prompt }
  }

  /** @param worldId 世界 UUID。 @param input 批量启用状态。 @returns 更新后的完整工作区。 */
  async updateWorldSourceStates(worldId: string, input: BatchEnabledStateInput): Promise<WorldGrowthWorkspaceView> {
    await this.requireWorld(worldId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updateWorldGrowthSourceStates(
      worldId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分世界资料不存在或不属于当前世界')
    return await this.getWorldGrowthWorkspace(worldId)
  }

  /** @param personaId 人物 UUID。 @returns 反馈资料和成长完整工作区。 */
  async getPersonaGrowthWorkspace(personaId: string): Promise<PersonaGrowthWorkspaceView> {
    await this.requirePersona(personaId)
    const [sources, materials, prompt] = await Promise.all([
      this.dependencies.content.listPersonaSources(personaId),
      this.dependencies.learning.listGrowthMaterials('persona', personaId),
      this.getLearningPromptWorkspace('persona_growth', personaId),
    ])
    return { sources: toGrowthLibrarySources(sources, materials), materials, prompt }
  }

  /** @param personaId 人物 UUID。 @param input 人工反馈资料。 @returns 新建资料。 */
  async createPersonaFeedbackSource(personaId: string, input: CreatePersonaFeedbackSourceInput): Promise<PersonaFeedbackSourceView> {
    await this.requirePersona(personaId)
    const id = this.dependencies.identifiers.create()
    await this.dependencies.learning.createPersonaFeedbackSource({
      id,
      personaId,
      title: input.title,
      content: input.content,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      timestamp: this.dependencies.clock.now(),
    })
    await this.enqueueFeedbackSourceSynchronization(id)
    const created = (await this.dependencies.learning.listPersonaFeedbackSources(personaId)).find(item => item.id === id)
    if (!created) throw new ApplicationError('PERSISTENCE_CONFLICT', '反馈资料创建后无法读取', 409)
    return created
  }

  /** @param personaId 人物 UUID。 @param input 批量启用状态。 @returns 更新后的完整工作区。 */
  async updatePersonaFeedbackSourceStates(personaId: string, input: BatchEnabledStateInput): Promise<PersonaGrowthWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updatePersonaFeedbackSourceStates(
      personaId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分反馈资料不存在、待删除或不属于当前人物')
    return await this.getPersonaGrowthWorkspace(personaId)
  }

  /** @param personaId 人物 UUID。 @param input 批量删除标识。 @returns 更新后的完整工作区。 */
  async deletePersonaFeedbackSources(personaId: string, input: DeletePersonaFeedbackSourcesInput): Promise<PersonaGrowthWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.deletePersonaFeedbackSources(
      personaId, ids, this.dependencies.clock.now(), Boolean(this.dependencies.contextSyncQueue),
    )
    requireCompleteBatch(changes, ids.length, '部分反馈资料不存在、待删除或不属于当前人物')
    for (const id of ids) await this.enqueueFeedbackSourceSynchronization(id)
    return await this.getPersonaGrowthWorkspace(personaId)
  }

  /**
   * 手工添加一份只用于成长提炼的原始文档。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前对象 UUID。
   * @param input 素材标题、完整正文和 AI 提炼权重。
   * @returns 添加后的成长工作区。
   */
  async createGrowthMaterial(
    subjectType: 'world' | 'persona',
    subjectId: string,
    input: CreateGrowthMaterialInput,
  ): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    await this.dependencies.learning.createGrowthMaterial({
      id: this.dependencies.identifiers.create(), subjectType, subjectId,
      title: input.title, content: input.content, sourceType: 'manual', sourceId: null, sourceHash: null,
      importance: input.importance, timestamp: this.dependencies.clock.now(),
    })
    return await this.getGrowthWorkspace(subjectType, subjectId)
  }

  /**
   * 修改一份成长素材的标题、正文快照和提炼权重。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前对象 UUID。
   * @param materialId 成长素材 UUID。
   * @param input 新标题、正文和评分。
   * @returns 修改后的成长工作区。
   */
  async updateGrowthMaterial(
    subjectType: 'world' | 'persona',
    subjectId: string,
    materialId: string,
    input: UpdateGrowthMaterialInput,
  ): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const current = (await this.dependencies.learning.listGrowthMaterials(subjectType, subjectId))
      .find(item => item.id === materialId)
    if (!current) throw new ApplicationError('RESOURCE_NOT_FOUND', '成长素材不存在或不属于当前对象', 404)
    const updated = await this.dependencies.learning.updateGrowthMaterial({
      id: materialId, subjectType, subjectId, title: input.title, content: input.content,
      sourceType: current.sourceType, sourceId: current.sourceId,
      sourceHash: current.sourceType === 'source_material' ? current.contentHash : null,
      importance: input.importance, timestamp: this.dependencies.clock.now(),
    })
    if (!updated) throw new ApplicationError('VERSION_CONFLICT', '成长素材已经变化，请刷新后重试', 409)
    return await this.getGrowthWorkspace(subjectType, subjectId)
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param input 人工成长候选。 @returns 更新后的成长工作区。 */
  async createGrowth(subjectType: 'world' | 'persona', subjectId: string, input: CreateGrowthInput): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const sourceIds = uniqueIds(input.sourceIds)
    await this.validateGrowthSources(subjectType, subjectId, sourceIds)
    await this.dependencies.learning.createGrowth({
      id: this.dependencies.identifiers.create(),
      revisionId: this.dependencies.identifiers.create(),
      subjectType,
      subjectId,
      content: input.content,
      scope: DEFAULT_GROWTH_SCOPE,
      importance: input.importance,
      sourceIds,
      timestamp: this.dependencies.clock.now(),
    })
    return subjectType === 'world'
      ? await this.getWorldGrowthWorkspace(subjectId)
      : await this.getPersonaGrowthWorkspace(subjectId)
  }

  /**
   * 把当前对象资料库中的多份资料复制为成长素材快照；重复导入会刷新快照和评分。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前世界或人物 UUID。
   * @param input 每份资料的 UUID 与 1–5 分评分。
   * @returns 整批原子导入后的最新成长工作区。
   */
  async importGrowthSources(subjectType: 'world' | 'persona', subjectId: string, input: ImportGrowthSourcesInput): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const availableSources = subjectType === 'world'
      ? await this.dependencies.content.listWorldSources(subjectId)
      : await this.dependencies.content.listPersonaSources(subjectId)
    const sourceMap = new Map(availableSources.map(source => [source.id, source]))
    const records = input.items.map((item) => {
      const source = sourceMap.get(item.sourceId)
      if (!source) throw new ApplicationError('RESOURCE_SCOPE_MISMATCH', '部分导入资料不存在或不属于当前对象', 409)
      return {
        id: this.dependencies.identifiers.create(), subjectType, subjectId,
        title: source.name, content: source.contentText, sourceType: 'source_material' as const,
        sourceId: source.id, sourceHash: source.contentHash,
        importance: item.importance, timestamp: this.dependencies.clock.now(),
      }
    })
    await this.dependencies.learning.importGrowthMaterials(records)
    return await this.getGrowthWorkspace(subjectType, subjectId)
  }

  /**
   * 批量启用或禁用当前对象的成长素材。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前对象 UUID。
   * @param input 素材 UUID 集合和统一目标状态。
   * @returns 更新后的成长工作区。
   */
  async updateGrowthMaterialStates(
    subjectType: 'world' | 'persona',
    subjectId: string,
    input: BatchEnabledStateInput,
  ): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updateGrowthMaterialStates(
      subjectType, subjectId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分成长素材不存在或不属于当前对象')
    return await this.getGrowthWorkspace(subjectType, subjectId)
  }

  /**
   * 永久删除当前对象选中的成长素材快照，不影响资料库原文和已发布提示词。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前对象 UUID。
   * @param input 待删除素材 UUID 集合。
   * @returns 删除后的成长工作区。
   */
  async deleteGrowthMaterials(
    subjectType: 'world' | 'persona',
    subjectId: string,
    input: DeleteGrowthInput,
  ): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.deleteGrowthMaterials(
      subjectType, subjectId, ids, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分成长素材不存在或不属于当前对象')
    return await this.getGrowthWorkspace(subjectType, subjectId)
  }

  /**
   * 修改成长正文并建立新的不可变修订；新修订恢复为待确认状态。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前世界或人物 UUID。
   * @param growthId 待修改成长 UUID。
   * @param input 新正文和重要程度。
   * @returns 修改后的最新成长工作区。
   */
  async updateGrowth(subjectType: 'world' | 'persona', subjectId: string, growthId: string, input: UpdateGrowthInput): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const updated = await this.dependencies.learning.updateGrowth({
      id: growthId,
      revisionId: this.dependencies.identifiers.create(),
      subjectType,
      subjectId,
      content: input.content,
      scope: DEFAULT_GROWTH_SCOPE,
      importance: input.importance,
      timestamp: this.dependencies.clock.now(),
    })
    if (!updated) throw new ApplicationError('RESOURCE_NOT_FOUND', '成长不存在、已被取代或不属于当前对象', 404)
    return subjectType === 'world'
      ? await this.getWorldGrowthWorkspace(subjectId)
      : await this.getPersonaGrowthWorkspace(subjectId)
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param input 批量目标状态。 @returns 更新后的成长工作区。 */
  async updateGrowthStates(subjectType: 'world' | 'persona', subjectId: string, input: BatchLearningStatusInput): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updateGrowthStates(
      subjectType, subjectId, ids, input.status, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分成长不存在、不属于当前对象或状态不允许该操作')
    return subjectType === 'world'
      ? await this.getWorldGrowthWorkspace(subjectId)
      : await this.getPersonaGrowthWorkspace(subjectId)
  }

  /**
   * 永久删除当前对象下选中的成长、全部修订和证据快照。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前世界或人物 UUID。
   * @param input 待删除成长 UUID 集合。
   * @returns 原子删除后的最新成长工作区。
   */
  async deleteGrowth(subjectType: 'world' | 'persona', subjectId: string, input: DeleteGrowthInput): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.deleteGrowth(subjectType, subjectId, ids, this.dependencies.clock.now())
    requireCompleteBatch(changes, ids.length, '部分成长不存在或不属于当前对象')
    return subjectType === 'world'
      ? await this.getWorldGrowthWorkspace(subjectId)
      : await this.getPersonaGrowthWorkspace(subjectId)
  }

  /** @param personaId 人物 UUID。 @returns 处理记录和记忆完整工作区。 */
  async getPersonaMemoryWorkspace(personaId: string): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const [operationRecords, externalRecords, prompt] = await Promise.all([
      this.dependencies.learning.listPersonaOperationRecords(personaId),
      this.dependencies.learning.listPersonaExternalRecords(personaId),
      this.getLearningPromptWorkspace('persona_memory', personaId),
    ])
    return { operationRecords, externalRecords, prompt }
  }

  /** @param personaId 人物 UUID。 @param input 处理记录批量启用状态。 @returns 更新后的记忆工作区。 */
  async updateOperationRecordStates(personaId: string, input: BatchEnabledStateInput): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updatePersonaOperationRecordStates(
      personaId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分处理记录不存在或不属于当前人物')
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /**
   * 修改一条历史任务记忆素材的 AI 提炼权重。
   * @param personaId 人物 UUID。
   * @param recordId 历史任务处理记录 UUID。
   * @param input 新的 1 到 5 分权重。
   * @returns 更新后的记忆工作区。
   */
  async updateOperationRecordImportance(
    personaId: string,
    recordId: string,
    input: UpdateOperationRecordInput,
  ): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const updated = await this.dependencies.learning.updatePersonaOperationRecordImportance(
      personaId, recordId, input.importance, this.dependencies.clock.now(),
    )
    if (!updated) throw new ApplicationError('RESOURCE_NOT_FOUND', '历史任务不存在或不属于当前人物', 404)
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /**
   * 新建一条默认参加记忆提炼的第三方经历记录。
   * @param personaId 人物 UUID。
   * @param input 发生日期、事情正文、参考地址和评分。
   * @returns 创建后的完整人物记忆工作区。
   */
  async createExternalRecord(personaId: string, input: SaveExternalRecordInput): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    await this.dependencies.learning.createPersonaExternalRecord({
      id: this.dependencies.identifiers.create(), personaId, ...input, timestamp: this.dependencies.clock.now(),
    })
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /**
   * 修改一条当前人物的第三方经历记录。
   * @param personaId 人物 UUID。
   * @param recordId 第三方记录 UUID。
   * @param input 完整的新日期、正文、参考地址和评分。
   * @returns 修改后的完整人物记忆工作区。
   */
  async updateExternalRecord(
    personaId: string,
    recordId: string,
    input: SaveExternalRecordInput,
  ): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const updated = await this.dependencies.learning.updatePersonaExternalRecord({
      id: recordId, personaId, ...input, timestamp: this.dependencies.clock.now(),
    })
    if (!updated) throw new ApplicationError('RESOURCE_NOT_FOUND', '第三方记录不存在或不属于当前人物', 404)
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /**
   * 批量启用或禁用当前人物的第三方经历记录。
   * @param personaId 人物 UUID。
   * @param input 第三方记录 UUID 集合和目标状态。
   * @returns 更新后的完整人物记忆工作区。
   */
  async updateExternalRecordStates(personaId: string, input: BatchEnabledStateInput): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updatePersonaExternalRecordStates(
      personaId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分第三方记录不存在或不属于当前人物')
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /**
   * 永久删除当前人物选中的第三方经历记录，不改变已经发布的记忆提示词。
   * @param personaId 人物 UUID。
   * @param input 待删除第三方记录 UUID 集合。
   * @returns 删除后的完整人物记忆工作区。
   */
  async deleteExternalRecords(personaId: string, input: DeleteExternalRecordsInput): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.deletePersonaExternalRecords(
      personaId, ids, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分第三方记录不存在或不属于当前人物')
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /**
   * 保存一份不会立即影响新任务的完整学习提示词草稿。
   * @param promptType 世界成长、人物成长或人物记忆。
   * @param subjectId 当前世界或人物 UUID。
   * @param input 完整提示词正文和可选历史基线。
   * @returns 保存后的提示词工作区。
   */
  async saveLearningPromptDraft(
    promptType: LearningPromptType,
    subjectId: string,
    input: SaveLearningPromptDraftInput,
  ): Promise<LearningPromptWorkspaceView> {
    await this.requirePromptSubject(promptType, subjectId)
    if (input.baseVersionId && !await this.dependencies.learning.findLearningPromptVersion(promptType, subjectId, input.baseVersionId)) {
      throw new ApplicationError('VERSION_CONFLICT', '基础提示词版本不属于当前对象', 409)
    }
    const current = await this.getLearningPromptWorkspace(promptType, subjectId)
    return await this.dependencies.learning.saveLearningPromptDraft({
      promptType, subjectId,
      promptId: this.dependencies.identifiers.create(), draftId: this.dependencies.identifiers.create(),
      baseVersionId: input.baseVersionId, promptText: input.promptText,
      sourceAnalysisBatchId: current.draft?.sourceAnalysisBatchId ?? null,
      createdBy: 'user', timestamp: this.dependencies.clock.now(),
    })
  }

  /**
   * 删除尚未发布的学习提示词草稿，不改变当前已发布版本。
   * @param promptType 世界成长、人物成长或人物记忆。
   * @param subjectId 当前世界或人物 UUID。
   * @returns 删除完成时结束。
   */
  async deleteLearningPromptDraft(promptType: LearningPromptType, subjectId: string): Promise<void> {
    await this.requirePromptSubject(promptType, subjectId)
    const deleted = await this.dependencies.learning.deleteLearningPromptDraft(promptType, subjectId)
    if (deleted !== 1) throw new ApplicationError('LEARNING_PROMPT_DRAFT_NOT_FOUND', '当前没有可删除的提示词草稿', 404)
  }

  /**
   * 从指定已发布历史版本复制一份新的可编辑学习提示词草稿。
   * @param promptType 世界成长、人物成长或人物记忆。
   * @param subjectId 当前世界或人物 UUID。
   * @param input 待复制历史版本 UUID。
   * @returns 创建后的提示词工作区。
   */
  async createLearningPromptDraftFromVersion(
    promptType: LearningPromptType,
    subjectId: string,
    input: CreateLearningPromptDraftFromVersionInput,
  ): Promise<LearningPromptWorkspaceView> {
    await this.requirePromptSubject(promptType, subjectId)
    const version = await this.dependencies.learning.findLearningPromptVersion(promptType, subjectId, input.versionId)
    if (!version) throw new ApplicationError('VERSION_CONFLICT', '历史提示词版本不属于当前对象', 409)
    return await this.dependencies.learning.saveLearningPromptDraft({
      promptType, subjectId,
      promptId: this.dependencies.identifiers.create(), draftId: this.dependencies.identifiers.create(),
      baseVersionId: version.id, promptText: version.promptText,
      sourceAnalysisBatchId: version.sourceAnalysisBatchId,
      createdBy: 'user', timestamp: this.dependencies.clock.now(),
    })
  }

  /**
   * 校验 Token 预算并发布当前草稿，使其固定进入之后创建的新任务。
   * @param promptType 世界成长、人物成长或人物记忆。
   * @param subjectId 当前世界或人物 UUID。
   * @param input 本次发布的变更说明。
   * @returns 新发布且已经生效的不可变提示词版本。
   */
  async publishLearningPromptDraft(
    promptType: LearningPromptType,
    subjectId: string,
    input: PublishLearningPromptDraftInput,
  ): Promise<LearningPromptVersionView> {
    await this.requirePromptSubject(promptType, subjectId)
    const workspace = await this.getLearningPromptWorkspace(promptType, subjectId)
    if (!workspace.draft) {
      if (workspace.activeVersion) return workspace.activeVersion
      throw new ApplicationError('LEARNING_PROMPT_DRAFT_NOT_FOUND', '当前没有可发布的提示词草稿', 404)
    }
    const count = this.dependencies.tokenCounter.count(null, workspace.draft.promptText)
    const budget = this.dependencies.promptTokenBudgets[promptType]
    if (count.tokens > budget) {
      throw new ApplicationError(
        'LEARNING_PROMPT_TOKEN_BUDGET_EXCEEDED',
        `提示词预计 ${count.tokens} Token，超过当前 ${budget} Token 限制，请先精简文本`,
        422,
      )
    }
    const published = await this.dependencies.learning.publishLearningPromptDraft({
      promptType, subjectId, versionId: this.dependencies.identifiers.create(),
      changeSummary: input.changeSummary, timestamp: this.dependencies.clock.now(),
    })
    if (!published) throw new ApplicationError('LEARNING_PROMPT_DRAFT_CONFLICT', '草稿已经变化，请刷新后重试', 409)
    return published
  }

  /** @param personaId 人物 UUID。 @param input 记忆批量目标状态。 @returns 更新后的记忆工作区。 */
  async updateMemoryStates(personaId: string, input: BatchLearningStatusInput): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updateMemoryStates(
      personaId, ids, input.status, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分记忆不存在、不属于当前人物或状态不允许该操作')
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /** @param personaId 人物 UUID。 @param memoryId 记忆 UUID。 @returns 由记忆显式创建的人物反馈资料。 */
  async convertMemoryToFeedbackSource(personaId: string, memoryId: string): Promise<PersonaFeedbackSourceView> {
    await this.requirePersona(personaId)
    const created = await this.dependencies.learning.convertMemoryToFeedbackSource(
      personaId, memoryId, this.dependencies.identifiers.create(), this.dependencies.clock.now(),
    )
    if (!created) throw new ApplicationError('RESOURCE_NOT_FOUND', '人物记忆不存在', 404)
    await this.enqueueFeedbackSourceSynchronization(created.id)
    return created
  }

  /**
   * 查询提示词工作区；尚未产生草稿或版本时返回稳定空工作区。
   * @param promptType 世界成长、人物成长或人物记忆。
   * @param subjectId 当前世界或人物 UUID。
   * @returns 草稿、当前版本和历史版本。
   */
  private async getLearningPromptWorkspace(
    promptType: LearningPromptType,
    subjectId: string,
  ): Promise<LearningPromptWorkspaceView> {
    return await this.dependencies.learning.findLearningPromptWorkspace(promptType, subjectId)
      ?? { promptType, activeVersion: null, draft: null, versions: [] }
  }

  /**
   * 根据对象类型返回成长素材、资料库和成长提示词的统一工作区。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前对象 UUID。
   * @returns 对应世界或人物成长工作区。
   */
  private async getGrowthWorkspace(
    subjectType: 'world' | 'persona',
    subjectId: string,
  ): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    return subjectType === 'world'
      ? await this.getWorldGrowthWorkspace(subjectId)
      : await this.getPersonaGrowthWorkspace(subjectId)
  }

  /**
   * 校验学习提示词类型与世界或人物归属一致。
   * @param promptType 世界成长、人物成长或人物记忆。
   * @param subjectId 当前对象 UUID。
   * @returns 对象存在且类型匹配时结束。
   */
  private async requirePromptSubject(promptType: LearningPromptType, subjectId: string): Promise<void> {
    if (promptType === 'world_growth') await this.requireWorld(subjectId)
    else await this.requirePersona(subjectId)
  }

  /** @param sourceId 人物反馈资料 UUID。 @returns 能力关闭时直接结束，否则持久任务入队后结束。 */
  private async enqueueFeedbackSourceSynchronization(sourceId: string): Promise<void> {
    if (!this.dependencies.contextSyncQueue) return
    await this.dependencies.contextSyncQueue.enqueueSourceSynchronization(
      sourceId,
      this.dependencies.identifiers.create(),
      this.dependencies.clock.now(),
      'persona_feedback_source',
    )
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @returns 对象存在时结束。 */
  private async requireSubject(subjectType: 'world' | 'persona', subjectId: string): Promise<void> {
    if (subjectType === 'world') await this.requireWorld(subjectId)
    else await this.requirePersona(subjectId)
  }

  /** @param worldId 世界 UUID。 @returns 世界存在时结束。 */
  private async requireWorld(worldId: string): Promise<void> {
    if (!await this.dependencies.content.findWorld(worldId)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '世界不存在', 404)
    }
  }

  /** @param personaId 人物 UUID。 @returns 人物存在时结束。 */
  private async requirePersona(personaId: string): Promise<void> {
    if (!await this.dependencies.content.findPersona(personaId)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '人物不存在', 404)
    }
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param sourceIds 来源 UUID。 @returns 来源全部归属当前对象时结束。 */
  private async validateGrowthSources(subjectType: 'world' | 'persona', subjectId: string, sourceIds: string[]): Promise<void> {
    if (sourceIds.length === 0) return
    const availableIds = new Set(subjectType === 'world'
      ? (await this.dependencies.learning.listWorldGrowthSources(subjectId)).map(item => item.id)
      : (await this.dependencies.learning.listPersonaFeedbackSources(subjectId)).map(item => item.id))
    if (sourceIds.some(id => !availableIds.has(id))) {
      throw new ApplicationError('RESOURCE_SCOPE_MISMATCH', '成长来源不存在或不属于当前对象', 409)
    }
  }
}

/** @param ids 可能重复的 UUID。 @returns 保持首次顺序的唯一 UUID。 */
function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

/** @param changes 实际处理数量。 @param expected 期望数量。 @param message 冲突说明。 @returns 数量一致时结束。 */
function requireCompleteBatch(changes: number, expected: number, message: string): void {
  if (changes !== expected) throw new ApplicationError('RESOURCE_SCOPE_MISMATCH', message, 409)
}

/**
 * 把对象关联资料转换为成长导入选项，并标记已经进入素材池的来源。
 * @param sources 当前人物或世界直接关联的资料库记录。
 * @param materials 当前对象已有的成长素材。
 * @returns 保持资料库顺序的成长来源选项。
 */
function toGrowthLibrarySources(
  sources: SourceMaterialRecord[],
  materials: Array<{ sourceType: string, sourceId: string | null }>,
): GrowthLibrarySourceView[] {
  const importedIds = new Set(materials
    .filter(item => item.sourceType === 'source_material' && item.sourceId)
    .map(item => item.sourceId as string))
  return sources.map(source => ({
    id: source.id, name: source.name, summary: source.contentText.slice(0, 240),
    content: source.contentText, contentHash: source.contentHash,
    isEnabled: source.isEnabled, isImported: importedIds.has(source.id),
  }))
}
