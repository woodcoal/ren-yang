import { ZodError } from 'zod'
import {
  personaDraftSchema,
  worldDraftSchema,
  worldSnapshotSchema,
  type GeneratePersonaDraftInput,
  type GenerateWorldDraftInput,
} from '../../../shared/schemas/content'
import type { PersonaDraftView, WorldDraftView } from '../../../shared/types/content'
import {
  documentSpecSchema,
  interestAssessmentSchema,
  textBlockOutputSchema,
  type ArtifactFormat,
  type CreateFormatTemplateInput,
  type CreateGenerationRunInput,
  type CreateInterestRunInput,
  type CreateParameterProfileInput,
  type DocumentSpec,
  type TextModelParameters,
} from '../../../shared/schemas/generation'
import type {
  CreatedRun,
  FormatTemplateView,
  ParameterProfileView,
  PromptContextCategory,
  PromptContextItemSnapshot,
  PromptContextSnapshot,
  RunDetails,
  RenderedArtifactView,
  RunSummary,
} from '../../../shared/types/generation'
import type { SystemCapabilitiesResult } from '../../../shared/types/system'
import type { LearningPromptVersionView } from '../../../shared/types/learning'
import type { PersonaRecord, PersonaVersionRecord } from '../../domain/content/ContentModels'
import { ImageAssetError } from '../../domain/generation/ImageAssetError'
import type { ArtifactBlockRecord, GenerationRunRecord, TextModelUsage } from '../../domain/generation/GenerationModels'
import { selectPromptContextByBudget, type PromptBudgetCandidate } from '../../domain/generation/PromptContextBudget'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { ContextProvider } from '../../ports/ContextProvider'
import { ContextProviderError } from '../../ports/ContextProvider'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { ImageAssetStorage } from '../../ports/ImageAssetStorage'
import type { ImageModelPort } from '../../ports/ImageModelPort'
import { ImageModelError } from '../../ports/ImageModelPort'
import { StorageCapacityError } from '../../ports/StorageCapacity'
import type { NewEvidenceSnapshot, RunListFilter, RunRepository } from '../../ports/RunRepository'
import type { SourceContentProcessor } from '../../ports/SourceContentPorts'
import type { LearningRepository } from '../../ports/LearningRepository'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import type { TextModelPort } from '../../ports/TextModelPort'
import type { TokenCounter } from '../../ports/TokenCounter'
import { TextModelError } from '../../ports/TextModelPort'
import { ApplicationError } from '../errors/ApplicationError'
import {
  buildDocumentPlanPrompt,
  buildImagePrompt,
  buildInterestPrompt,
  buildPersonaDraftPrompt,
  buildTextBlockPrompt,
  buildWorldDraftPrompt,
  GENERATION_PROMPT_VERSION,
  type PromptContext,
} from './PromptBuilder'
import { renderArtifact, type SelectedArtifactBlock } from './ArtifactRenderer'
import { packageArtifact, type ExportedArtifact } from './ArtifactPackager'

/** 未选择参数方案时使用并保存到运行快照的默认参数。 */
export const DEFAULT_TEXT_PARAMETERS: TextModelParameters = {
  temperature: 0.4,
  maxOutputTokens: 2_048,
  timeoutMs: 60_000,
  maxEvidenceChunks: 8,
  maxTextBlocks: 12,
  maxImageBlocks: 4,
  maxPromptCharacters: 120_000,
  maxTotalTokens: 50_000,
  maxBlockAttempts: 2,
  contextWindowTokens: 32_768,
  reservedOutputTokens: 4_096,
  safetyMarginTokens: 2_048,
  worldBudgetTokens: 5_000,
  worldSoulBudgetTokens: 2_500,
  worldGrowthBudgetTokens: 2_500,
  personaBudgetTokens: 9_000,
  personaSoulBudgetTokens: 3_500,
  personaGrowthBudgetTokens: 2_500,
  personaMemoryBudgetTokens: 3_000,
  sourceBudgetTokens: 5_000,
}

/** 未选择格式模板时使用的最小文档结构指导。 */
const DEFAULT_FORMAT_TEMPLATE = {
  guidance: '按用户要求组织清晰的内容；标题、正文、列表以及已启用的辅助图片按需要使用。',
  minimumBlocks: 1,
  maximumBlocks: 8,
}

/** 人物草稿单项资料最多发送给模型的字符数。 */
const PERSONA_DRAFT_SOURCE_CHARACTER_LIMIT = 5_000

/** 人物草稿世界最多发送给模型的字符数。 */
const PERSONA_DRAFT_WORLD_CHARACTER_LIMIT = 10_000

/** 生成应用服务依赖。 */
export interface GenerationApplicationServiceDependencies {
  runs: RunRepository
  content: ContentRepository
  context: ContextProvider
  model: TextModelPort
  imageModel: ImageModelPort
  imageAssets: ImageAssetStorage
  identifiers: IdentifierGenerator
  clock: Clock
  sourceProcessor: SourceContentProcessor
  /** 调用前执行分层提示词预算的 Token 计数器。 */
  tokenCounter: TokenCounter
  /** 当前学习提示词和人物处理记录事实源。 */
  learning: Pick<LearningRepository, 'findLearningPromptWorkspace' | 'createPersonaOperationRecord'>
  /** OpenViking 启用时使用的 Session 异步队列。 */
  contextSyncQueue?: ContextSyncTaskQueue
}

/** 编排运行创建、查询、规格确认和 Worker 模型执行。 */
export class GenerationApplicationService implements TaskHandler {
  /** @param dependencies 运行、内容、检索、模型、标识、时间和哈希端口。 */
  constructor(private readonly dependencies: GenerationApplicationServiceDependencies) { }

  /** @returns 文本模型非敏感能力状态。 */
  getTextModelCapability() {
    const configured = this.dependencies.model.getConfiguredModel()
    return configured
      ? { configured: true, ...configured }
      : { configured: false, provider: 'openai_compatible' as const, model: null, endpointOrigin: null }
  }

  /** @returns 当前阶段全部非敏感外部能力和实际上下文提供器。 */
  getCapabilities(): SystemCapabilitiesResult {
    const imageModel = this.dependencies.imageModel.getConfiguredModel()
    const openViking = this.dependencies.context.getOpenVikingCapability()
    return {
      textModel: this.getTextModelCapability(),
      imageModel: imageModel
        ? { configured: true, ...imageModel }
        : { configured: false, provider: 'openai_compatible_images' as const, model: null, endpointOrigin: null },
      openViking,
      contextProvider: this.dependencies.context.getProvider(),
      defaultParameters: { ...DEFAULT_TEXT_PARAMETERS },
    }
  }

  /**
   * 把自然语言、可选世界和参考资料整理为待人工确认的人物草稿。
   * @param input 已校验的草稿生成输入。
   * @returns 不写入数据库的结构化草稿及非阻断截断提示。
   */
  async generatePersonaDraft(input: GeneratePersonaDraftInput): Promise<PersonaDraftView> {
    if (!this.dependencies.model.getConfiguredModel()) {
      throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置，不能生成人物草稿', 422)
    }
    const sourceIds = [...new Set(input.sourceIds)]

    const warnings: string[] = []
    let world = null
    if (input.worldId) {
      const worldRecord = await this.dependencies.content.findWorld(input.worldId)
      if (!worldRecord) throw new ApplicationError('RESOURCE_NOT_FOUND', '世界不存在', 404)
      if (!worldRecord.activeVersionId) {
        throw new ApplicationError('WORLD_VERSION_NOT_ACTIVE', '所选世界当前灵魂版本缺失', 409)
      }
      const version = await this.dependencies.content.findWorldVersion(worldRecord.activeVersionId)
      if (!version || version.status !== 'published') {
        throw new ApplicationError('WORLD_VERSION_NOT_ACTIVE', '所选世界当前版本不可用', 409)
      }
      const promptText = version.snapshot.promptText.slice(0, PERSONA_DRAFT_WORLD_CHARACTER_LIMIT)
      world = { promptText }
      if (promptText.length < version.snapshot.promptText.length) {
        warnings.push('世界灵魂提示词较长，生成人物草稿时仅使用前 10000 字')
      }
    }

    const sources = await Promise.all(sourceIds.map(async (sourceId) => {
      const source = await this.dependencies.content.findSource(sourceId)
      if (!source) throw new ApplicationError('RESOURCE_NOT_FOUND', '所选参考资料不存在', 404)
      const content = source.contentText.slice(0, PERSONA_DRAFT_SOURCE_CHARACTER_LIMIT)
      if (content.length < source.contentText.length) warnings.push(`资料“${source.name}”较长，生成人物草稿时仅使用前 5000 字`)
      return { name: source.name, role: source.role, content }
    }))
    sources.sort((left, right) => sourceRoleRank(left.role) - sourceRoleRank(right.role) || left.name.localeCompare(right.name, 'zh-CN'))

    const prompt = buildPersonaDraftPrompt(input.prompt, world, sources)
    try {
      const { output } = await this.generateValidated(prompt, DEFAULT_TEXT_PARAMETERS, 'persona_draft', value => personaDraftSchema.parse(value))
      return { ...output, warnings }
    }
    catch (error: unknown) {
      const normalized = normalizeExecutionError(error)
      const statusCode = normalized.code === 'CAPABILITY_DISABLED' ? 422 : normalized.code === 'MODEL_OUTPUT_INVALID' ? 502 : 503
      throw new ApplicationError(normalized.code, normalized.message, statusCode)
    }
  }

  /**
   * 把自然语言整理为待人工确认的世界草稿。
   * @param input 已校验的世界自然语言输入。
   * @returns 不写入数据库的结构化世界草稿。
   */
  async generateWorldDraft(input: GenerateWorldDraftInput): Promise<WorldDraftView> {
    if (!this.dependencies.model.getConfiguredModel()) {
      throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置，不能生成世界草稿', 422)
    }
    try {
      const prompt = buildWorldDraftPrompt(input.prompt)
      const { output } = await this.generateValidated(prompt, DEFAULT_TEXT_PARAMETERS, 'world_draft', value => worldDraftSchema.parse(value))
      return output
    }
    catch (error: unknown) {
      const normalized = normalizeExecutionError(error)
      const statusCode = normalized.code === 'CAPABILITY_DISABLED' ? 422 : normalized.code === 'MODEL_OUTPUT_INVALID' ? 502 : 503
      throw new ApplicationError(normalized.code, normalized.message, statusCode)
    }
  }

  /** @returns 全部参数方案版本。 */
  async listParameterProfiles(): Promise<ParameterProfileView[]> { return await this.dependencies.runs.listParameterProfiles() }

  /** @param input 已校验参数方案。 @returns 新的不可变方案版本。 */
  async createParameterProfile(input: CreateParameterProfileInput): Promise<ParameterProfileView> {
    return await this.dependencies.runs.createParameterProfile(this.dependencies.identifiers.create(), input.name, input.values, this.dependencies.clock.now())
  }

  /** @returns 全部格式模板版本。 */
  async listFormatTemplates(): Promise<FormatTemplateView[]> { return await this.dependencies.runs.listFormatTemplates() }

  /** @param input 已校验格式模板。 @returns 新的不可变模板版本。 */
  async createFormatTemplate(input: CreateFormatTemplateInput): Promise<FormatTemplateView> {
    return await this.dependencies.runs.createFormatTemplate(this.dependencies.identifiers.create(), input.name, input.spec, this.dependencies.clock.now())
  }

  /** @param input 兴趣判断输入。 @returns 已入队运行与任务标识。 */
  async createInterestRun(input: CreateInterestRunInput): Promise<CreatedRun> {
    return await this.createRun('interest_assessment', input.personaId, { content: input.content }, input.scene ?? null, input.parameterProfileId ?? null, null)
  }

  /** @param input 文档规划输入。 @returns 处于规划状态的运行与任务标识。 */
  async createGenerationRun(input: CreateGenerationRunInput): Promise<CreatedRun> {
    const includeImages = input.includeImages ?? false
    return await this.createRun('artifact_generation', input.personaId, { requirement: input.requirement, includeImages }, input.scene ?? null, input.parameterProfileId ?? null, input.formatTemplateId ?? null)
  }

  /** @param filter 已校验运行过滤条件。 @returns 运行摘要列表。 */
  async listRuns(filter: RunListFilter): Promise<RunSummary[]> {
    const runs = await this.dependencies.runs.listRuns(filter)
    return await Promise.all(runs.map(run => this.toRunSummary(run)))
  }

  /** @param runId 运行 UUID。 @returns 运行、证据、规格、块、尝试和任务。 */
  async getRun(runId: string): Promise<RunDetails> {
    const run = await this.requireRun(runId)
    const [evidence, documentSpecs, blocks, tasks, imageAssets] = await Promise.all([
      this.dependencies.runs.listEvidence(runId),
      this.dependencies.runs.listDocumentSpecs(runId),
      this.dependencies.runs.listBlocks(runId),
      this.dependencies.runs.listRunTasks(runId),
      this.dependencies.runs.listImageAssets(runId),
    ])
    const assetsByAttempt = new Map(imageAssets.map(asset => [asset.attemptId, asset]))
    return {
      run: await this.toRunSummary(run),
      evidence: evidence.map(({ runId: _, createdAt: __, ...item }) => item),
      documentSpecs: documentSpecs.map(({ runId: _, ...item }) => item),
      blocks: await Promise.all(blocks.map(async block => ({
        id: block.id, specKey: block.specKey, ordinal: block.ordinal, type: block.type, role: block.role,
        instruction: block.spec.instruction, acceptanceCriteria: block.spec.acceptanceCriteria,
        status: block.status, selectedAttemptId: block.selectedAttemptId, isLocked: block.isLocked, selectedAt: block.selectedAt, lockedAt: block.lockedAt,
        attempts: (await this.dependencies.runs.listBlockAttempts(block.id)).map(({ blockId: _, inputSnapshot: __, ...attempt }) => {
          const asset = assetsByAttempt.get(attempt.id)
          return { ...attempt, asset: asset ? { id: asset.id, relativePath: asset.relativePath, mediaType: asset.mediaType, sizeBytes: asset.sizeBytes, contentHash: asset.contentHash, altText: asset.altText } : null }
        }),
      }))),
      tasks,
    }
  }

  /** @param runId 运行 UUID。 @param spec 已校验用户规格。 @returns 新规格修订。 */
  async reviseDocumentSpec(runId: string, spec: DocumentSpec) {
    const run = await this.requireRun(runId)
    if (run.kind !== 'artifact_generation' || run.status !== 'awaiting_confirmation') {
      throw new ApplicationError('DOCUMENT_SPEC_NOT_EDITABLE', '当前运行没有可编辑的待确认规格', 409)
    }
    this.validateDocumentLimits(spec, run)
    const revised = await this.dependencies.runs.reviseDocumentSpec(runId, this.dependencies.identifiers.create(), spec, this.dependencies.clock.now())
    if (!revised) throw new ApplicationError('VERSION_CONFLICT', '规格状态已经变化，请刷新后重试', 409)
    return revised
  }

  /** @param runId 运行 UUID。 @returns 确认后的运行详情。 */
  async confirmDocumentSpec(runId: string): Promise<RunDetails> {
    const run = await this.requireRun(runId)
    const specs = await this.dependencies.runs.listDocumentSpecs(runId)
    const draft = specs.find(spec => spec.status === 'draft')
    if (run.status !== 'awaiting_confirmation' || !draft) {
      throw new ApplicationError('DOCUMENT_SPEC_NOT_CONFIRMED', '没有可确认的文档规格', 409)
    }
    this.validateDocumentLimits(draft.spec, run)
    const confirmed = await this.dependencies.runs.confirmDocumentSpec(
      runId,
      this.dependencies.identifiers.create(),
      this.dependencies.identifiers.create(),
      draft.spec.blocks.map(() => this.dependencies.identifiers.create()),
      this.dependencies.clock.now(),
    )
    if (!confirmed) throw new ApplicationError('VERSION_CONFLICT', '规格状态已经变化，请刷新后重试', 409)
    return await this.getRun(runId)
  }

  /** @param runId 运行 UUID。 @returns 接受取消后的详情。 */
  async cancelRun(runId: string): Promise<RunDetails> {
    await this.requireRun(runId)
    if (!await this.dependencies.runs.requestCancellation(runId, this.dependencies.clock.now())) {
      throw new ApplicationError('RUN_NOT_CANCELABLE', '当前运行状态不能取消', 409)
    }
    return await this.getRun(runId)
  }

  /** @param runId 失败或部分成功运行 UUID。 @returns 新建任务和恢复后的运行状态。 */
  async retryRun(runId: string): Promise<CreatedRun> {
    const run = await this.requireRun(runId)
    if (!['failed', 'partial'].includes(run.status)) {
      throw new ApplicationError('RUN_NOT_RETRYABLE', '只有失败或部分成功的运行可以重试', 409)
    }
    this.requireMatchingModel(run)
    this.requireMatchingImageModel(run)
    const taskId = this.dependencies.identifiers.create()
    const retried = await this.dependencies.runs.retryRun(runId, taskId, this.dependencies.clock.now())
    if (!retried) throw new ApplicationError('VERSION_CONFLICT', '运行状态已经变化，请刷新后重试', 409)
    return { runId, taskId, status: retried.status }
  }

  /** @param runId 运行 UUID。 @param blockId 目标块 UUID。 @returns 新单块任务。 */
  async retryBlock(runId: string, blockId: string): Promise<CreatedRun> {
    const run = await this.requireRun(runId)
    if (!['succeeded', 'partial', 'failed'].includes(run.status)) throw new ApplicationError('RUN_NOT_RETRYABLE', '运行尚未结束，不能单独重试块', 409)
    this.requireMatchingModel(run)
    const block = (await this.dependencies.runs.listBlocks(runId)).find(item => item.id === blockId)
    if (!block) throw new ApplicationError('RESOURCE_NOT_FOUND', '产物块不存在', 404)
    if (block.isLocked) throw new ApplicationError('BLOCK_LOCKED', '锁定块不能重试', 409)
    if ((await this.dependencies.runs.listBlockAttempts(blockId)).length >= run.parameterSnapshot.maxBlockAttempts) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '该块已达到运行快照规定的最大尝试数', 422)
    }
    if (block.type === 'image') this.requireMatchingImageModel(run)
    const taskId = this.dependencies.identifiers.create()
    if (!await this.dependencies.runs.enqueueBlockRetry(runId, blockId, taskId, this.dependencies.clock.now())) {
      throw new ApplicationError('VERSION_CONFLICT', '块或运行状态已经变化', 409)
    }
    return { runId, taskId, status: 'queued' }
  }

  /** @param runId 运行 UUID。 @param blockId 块 UUID。 @param attemptId 成功尝试 UUID。 @returns 更新后的运行详情。 */
  async selectBlockAttempt(runId: string, blockId: string, attemptId: string): Promise<RunDetails> {
    await this.requireRun(runId)
    if (!await this.dependencies.runs.selectBlockAttempt(runId, blockId, attemptId, this.dependencies.clock.now())) {
      throw new ApplicationError('BLOCK_ATTEMPT_NOT_SELECTABLE', '尝试不存在、未成功或不属于该块', 409)
    }
    return await this.getRun(runId)
  }

  /** @param runId 运行 UUID。 @param blockId 块 UUID。 @param locked 新锁定值。 @returns 更新后的运行详情。 */
  async setBlockLock(runId: string, blockId: string, locked: boolean): Promise<RunDetails> {
    await this.requireRun(runId)
    if (!await this.dependencies.runs.setBlockLock(runId, blockId, locked, this.dependencies.clock.now())) {
      throw new ApplicationError('BLOCK_NOT_LOCKABLE', '只有已选择成功尝试的块可以锁定或解除锁定', 409)
    }
    return await this.getRun(runId)
  }

  /** @param runId 运行 UUID。 @param formats 目标格式。 @returns 同一组选中块的安全预览。 */
  async renderRun(runId: string, formats: ArtifactFormat[]): Promise<RenderedArtifactView> {
    const selected = await this.loadSelectedArtifact(runId)
    assertFormatsRequested(selected.spec, formats)
    return {
      runId,
      documents: renderArtifact(selected.spec, selected.blocks, formats),
      assets: selected.blocks.flatMap(item => item.asset
        ? [{ id: item.asset.id, relativePath: item.asset.relativePath, mediaType: item.asset.mediaType, sizeBytes: item.asset.sizeBytes, contentHash: item.asset.contentHash, altText: item.asset.altText }]
        : []),
    }
  }

  /** @param runId 运行 UUID。 @param format 唯一导出格式。 @returns 单文件或含图片资源的 ZIP。 */
  async exportRun(runId: string, format: ArtifactFormat): Promise<ExportedArtifact> {
    const run = await this.requireRun(runId)
    if (!['succeeded', 'partial', 'failed'].includes(run.status)) throw new ApplicationError('RUN_NOT_EXPORTABLE', '运行尚未结束，不能导出', 409)
    const selected = await this.loadSelectedArtifact(runId)
    assertFormatsRequested(selected.spec, [format])
    const document = renderArtifact(selected.spec, selected.blocks, [format])[format]
    if (!document) throw new Error('渲染器没有返回目标格式')
    const imageAssets = selected.blocks.flatMap(item => item.asset ? [item.asset] : [])
    const images = await Promise.all(imageAssets.map(async asset => ({
      asset,
      bytes: await this.dependencies.imageAssets.readImage(runId, asset.relativePath),
    })))
    return packageArtifact(run, selected.spec.title, format, document, images, this.dependencies.clock.now())
  }

  /** @param runId 运行 UUID。 @param assetId 图片资产 UUID。 @returns 已授权运行内的图片字节与类型。 */
  async getImageAsset(runId: string, assetId: string): Promise<{ bytes: Uint8Array, mediaType: string }> {
    await this.requireRun(runId)
    const asset = await this.dependencies.runs.findImageAsset(runId, assetId)
    if (!asset) throw new ApplicationError('RESOURCE_NOT_FOUND', '图片资产不存在', 404)
    try {
      return { bytes: await this.dependencies.imageAssets.readImage(runId, asset.relativePath), mediaType: asset.mediaType }
    }
    catch (error: unknown) {
      if (error instanceof ImageAssetError) throw new ApplicationError(error.code, error.message, error.code === 'ASSET_NOT_FOUND' ? 404 : 400)
      throw error
    }
  }

  /** @param job Worker 已领取任务。 @returns 业务执行结束时完成。 */
  async execute(job: TaskJob): Promise<void> {
    const runId = readRunId(job.payloadJson)
    try {
      if (job.type === 'assess_interest') await this.executeInterest(runId)
      else if (job.type === 'plan_document') await this.executeDocumentPlan(runId)
      else if (job.type === 'execute_document') await this.executeDocument(runId)
      else if (job.type === 'execute_block') await this.executeSingleBlock(runId, readBlockId(job.payloadJson))
      else throw new Error(`未注册任务类型：${job.type}`)
      await this.enqueueRunSessionIfTerminal(runId)
    }
    catch (error: unknown) {
      const responseUsage = error instanceof TextResponseUsageError ? error.usage : null
      if (await this.finishCancellationIfRequested(runId, responseUsage)) return
      if (responseUsage) await this.saveCumulativeRunUsage(runId, responseUsage)
      const normalized = normalizeExecutionError(error)
      const willRetry = normalized.retryable && job.attemptCount < job.maxAttempts
      if (willRetry) {
        await this.dependencies.runs.prepareAutomaticRetry(runId, job.type, this.dependencies.clock.now())
      }
      else {
        await this.dependencies.runs.failRun(runId, normalized.code, normalized.message, this.dependencies.clock.now())
        await this.enqueueRunSessionIfTerminal(runId)
      }
      throw new TaskExecutionError(`${normalized.code}：${normalized.message}`, normalized.retryable)
    }
  }

  /** @param runId 可能已结束的运行 UUID。 @returns 终态运行的 Session 任务排队完成时结束。 */
  private async enqueueRunSessionIfTerminal(runId: string): Promise<void> {
    if (!this.dependencies.contextSyncQueue) return
    const run = await this.dependencies.runs.findRun(runId)
    if (!run || !['succeeded', 'partial', 'failed'].includes(run.status)) return
    await this.dependencies.contextSyncQueue.enqueueSessionSynchronization(
      'run',
      runId,
      this.dependencies.identifiers.create(),
      this.dependencies.clock.now(),
    )
  }

  /** @param kind 运行类型。 @param personaId 人物 UUID。 @param input 固定输入。 @param scene 场景。 @param profileId 参数方案。 @param templateId 格式模板。 @returns 已创建运行。 */
  private async createRun(kind: GenerationRunRecord['kind'], personaId: string, input: GenerationRunRecord['input'], scene: GenerationRunRecord['scene'], profileId: string | null, templateId: string | null): Promise<CreatedRun> {
    const model = this.dependencies.model.getConfiguredModel()
    if (!model) throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置', 422)
    const imageModel = 'includeImages' in input && input.includeImages
      ? this.dependencies.imageModel.getConfiguredModel()
      : null
    if ('includeImages' in input && input.includeImages && !imageModel) {
      throw new ApplicationError('CAPABILITY_DISABLED', '图片模型尚未配置，不能创建包含图片的运行', 422)
    }
    const persona = await this.requirePersona(personaId)
    if (!persona.isEnabled) throw new ApplicationError('RESOURCE_DISABLED', '人物已禁用，不能创建新任务', 409)
    if (!persona.activeVersionId) throw new ApplicationError('PERSONA_VERSION_NOT_ACTIVE', '人物当前灵魂版本缺失，请重新保存灵魂提示词', 409)
    const version = await this.requirePublishedPersonaVersion(persona.activeVersionId, persona.id)
    const parameters = await this.resolveParameters(profileId)
    const template = templateId ? await this.requireFormatTemplate(templateId) : { spec: DEFAULT_FORMAT_TEMPLATE }
    const linkedWorld = persona.worldId ? await this.dependencies.content.findWorld(persona.worldId) : null
    const world = linkedWorld?.isEnabled ? linkedWorld : null
    const effectivePersona = world ? persona : { ...persona, worldId: null }
    const worldVersion = world?.activeVersionId ? await this.dependencies.content.findWorldVersion(world.activeVersionId) : null
    const activeWorldVersion = worldVersion?.status === 'published' ? worldVersion : null
    const [worldGrowthWorkspace, personaGrowthWorkspace, personaMemoryWorkspace] = await Promise.all([
      world ? this.dependencies.learning.findLearningPromptWorkspace('world_growth', world.id) : Promise.resolve(null),
      this.dependencies.learning.findLearningPromptWorkspace('persona_growth', persona.id),
      this.dependencies.learning.findLearningPromptWorkspace('persona_memory', persona.id),
    ])
    const worldGrowthVersion = worldGrowthWorkspace?.activeVersion ?? null
    const personaGrowthVersion = personaGrowthWorkspace?.activeVersion ?? null
    const personaMemoryVersion = personaMemoryWorkspace?.activeVersion ?? null
    const query = 'content' in input ? input.content : input.requirement
    let contextSearch
    try {
      contextSearch = await this.dependencies.context.search({ personaId, worldId: effectivePersona.worldId, query, limit: parameters.maxEvidenceChunks })
    }
    catch (error: unknown) {
      if (error instanceof ContextProviderError) {
        throw new ApplicationError('PROVIDER_UNAVAILABLE', error.message, 503)
      }
      throw error
    }
    const runId = this.dependencies.identifiers.create()
    const taskId = this.dependencies.identifiers.create()
    const timestamp = this.dependencies.clock.now()
    const emptyPromptContext: PromptContext = {
      persona: version.snapshot,
      world: activeWorldVersion?.snapshot ?? null,
      worldGrowthPrompt: worldGrowthVersion?.promptText ?? null,
      personaGrowthPrompt: personaGrowthVersion?.promptText ?? null,
      personaMemoryPrompt: personaMemoryVersion?.promptText ?? null,
      scene,
      evidence: [],
    }
    const fixedPrompt = this.buildInitialRunPrompt(kind, input, template.spec, parameters, emptyPromptContext)
    const tokenCounterModel = model.model
    const fixedInputTokens = this.countPromptTokens(tokenCounterModel, fixedPrompt)
    const worldSoulCount = activeWorldVersion
      ? this.dependencies.tokenCounter.count(tokenCounterModel, activeWorldVersion.snapshot.promptText)
      : { tokens: 0, mode: 'estimated' as const, counter: 'none' }
    const personaSoulCount = this.dependencies.tokenCounter.count(tokenCounterModel, version.snapshot.promptText)
    const worldGrowthCount = countOptionalPrompt(this.dependencies.tokenCounter, tokenCounterModel, worldGrowthVersion?.promptText)
    const personaGrowthCount = countOptionalPrompt(this.dependencies.tokenCounter, tokenCounterModel, personaGrowthVersion?.promptText)
    const personaMemoryCount = countOptionalPrompt(this.dependencies.tokenCounter, tokenCounterModel, personaMemoryVersion?.promptText)
    const prepared = await this.preparePromptBudgetCandidates(
      effectivePersona,
      contextSearch.candidates,
      tokenCounterModel,
    )
    let selection
    try {
      selection = selectPromptContextByBudget({
        parameters,
        fixedInputTokens,
        worldSoulTokens: worldSoulCount.tokens,
        personaSoulTokens: personaSoulCount.tokens,
        worldGrowthTokens: worldGrowthCount.tokens,
        personaGrowthTokens: personaGrowthCount.tokens,
        personaMemoryTokens: personaMemoryCount.tokens,
        candidates: prepared.valid.map(item => item.budget),
      })
    }
    catch (error: unknown) {
      throw new ApplicationError('PROMPT_BUDGET_EXCEEDED', error instanceof Error ? error.message : '提示词预算不足', 422)
    }
    const preparedByKey = new Map(prepared.valid.map(item => [promptBudgetCandidateKey(item.budget), item]))
    const selectedEvidence = selection.selected
      .map(candidate => preparedByKey.get(promptBudgetCandidateKey(candidate)))
      .filter((item): item is PreparedPromptCandidates['valid'][number] => Boolean(item))
      .map((item, index): NewEvidenceSnapshot => ({
        id: item.evidenceId,
        sourceId: item.sourceId,
        chunkId: item.chunkId,
        role: item.budget.role,
        content: item.budget.content,
        contentHash: item.budget.contentHash,
        rank: index,
        metadata: { heading: item.heading, priority: item.priority, category: item.budget.category, entityId: item.budget.entityId },
      }))
    const promptContext: PromptContext = {
      ...emptyPromptContext,
      evidence: selectedEvidence.map(item => ({ ...item, runId, createdAt: timestamp })),
    }
    const initialPrompt = this.buildInitialRunPrompt(kind, input, template.spec, parameters, promptContext)
    const estimatedInputTokens = this.countPromptTokens(tokenCounterModel, initialPrompt)
    if (estimatedInputTokens > selection.availableInputTokens) {
      throw new ApplicationError('PROMPT_BUDGET_EXCEEDED', '最终提示词超过可用输入 Token，请减少任务内容或上下文预算', 422)
    }
    const userSettingContent = JSON.stringify(version.snapshot)
    const userSettings: NewEvidenceSnapshot[] = [
      {
        id: this.dependencies.identifiers.create(), sourceId: null, chunkId: null, role: 'user_setting' as const,
        content: userSettingContent, contentHash: this.dependencies.sourceProcessor.hash(userSettingContent),
        rank: 0, metadata: { personaVersionId: version.id },
      },
    ]
    if (activeWorldVersion) {
      const content = JSON.stringify(activeWorldVersion.snapshot)
      userSettings.push({
        id: this.dependencies.identifiers.create(), sourceId: null, chunkId: null, role: 'user_setting',
        content, contentHash: this.dependencies.sourceProcessor.hash(content), rank: 1,
        metadata: { worldVersionId: activeWorldVersion.id },
      })
    }
    const fixedLearningPrompts = [
      toFixedLearningPromptEvidence(this.dependencies.identifiers.create(), worldGrowthVersion, 'world_growth', 'growth', worldGrowthCount.tokens, this.dependencies.sourceProcessor),
      toFixedLearningPromptEvidence(this.dependencies.identifiers.create(), personaGrowthVersion, 'persona_growth', 'growth', personaGrowthCount.tokens, this.dependencies.sourceProcessor),
      toFixedLearningPromptEvidence(this.dependencies.identifiers.create(), personaMemoryVersion, 'persona_memory', 'memory', personaMemoryCount.tokens, this.dependencies.sourceProcessor),
    ].filter((item): item is { evidence: NewEvidenceSnapshot, snapshot: PromptContextItemSnapshot } => item !== null)
    const selectedSnapshots = [
      ...fixedLearningPrompts.map(item => item.snapshot),
      ...selection.selected.map(candidate => toPromptContextItemSnapshot(candidate, null)),
    ]
    const skippedSnapshots = [
      ...selection.skipped.map(candidate => toPromptContextItemSnapshot(candidate, candidate.skippedReason)),
      ...prepared.invalid,
    ]
    const promptContextSnapshot: PromptContextSnapshot = {
      tokenCounter: personaSoulCount.counter,
      tokenCountExact: [personaSoulCount, worldSoulCount, worldGrowthCount, personaGrowthCount, personaMemoryCount]
        .every(item => item.mode === 'exact' || item.tokens === 0),
      availableInputTokens: selection.availableInputTokens,
      estimatedInputTokens,
      budgets: {
        world: {
          limit: parameters.worldBudgetTokens, used: selection.used.world,
          soulLimit: parameters.worldSoulBudgetTokens, soulUsed: worldSoulCount.tokens,
          growthLimit: parameters.worldGrowthBudgetTokens, growthUsed: selection.used.worldGrowth,
        },
        persona: {
          limit: parameters.personaBudgetTokens, used: selection.used.persona,
          soulLimit: parameters.personaSoulBudgetTokens, soulUsed: personaSoulCount.tokens,
          growthLimit: parameters.personaGrowthBudgetTokens, growthUsed: selection.used.personaGrowth,
          memoryLimit: parameters.personaMemoryBudgetTokens, memoryUsed: selection.used.personaMemory,
        },
        sources: { limit: parameters.sourceBudgetTokens, used: selection.used.sources },
      },
      worldSoulVersionId: activeWorldVersion?.id ?? null,
      personaSoulVersionId: version.id,
      selected: selectedSnapshots,
      skipped: skippedSnapshots,
      systemPromptHash: this.dependencies.sourceProcessor.hash(initialPrompt.systemPrompt),
      userPromptHash: this.dependencies.sourceProcessor.hash(initialPrompt.userPrompt),
    }
    await this.dependencies.runs.createRun({
      runId, taskId, taskType: kind === 'interest_assessment' ? 'assess_interest' : 'plan_document', kind,
      personaVersionId: version.id, formatTemplateId: templateId, parameterProfileId: profileId,
      status: kind === 'interest_assessment' ? 'queued' : 'planning', input, scene, parameters, model, imageModel,
      promptVersion: GENERATION_PROMPT_VERSION,
      contextProvider: contextSearch.provider,
      promptContextSnapshot,
      evidence: [
        ...userSettings,
        ...fixedLearningPrompts.map((item, index) => ({ ...item.evidence, rank: userSettings.length + index })),
        ...selectedEvidence.map(item => ({ ...item, rank: item.rank + userSettings.length + fixedLearningPrompts.length })),
      ],
      timestamp,
    })
    return { runId, taskId, status: kind === 'interest_assessment' ? 'queued' : 'planning' }
  }

  /**
   * 构建创建运行时即可确定的首次文本模型提示。
   * @param kind 运行类型。
   * @param input 固定任务输入。
   * @param template 格式模板规格。
   * @param parameters 运行参数快照。
   * @param context 已选择的心智与资料上下文。
   * @returns 兴趣判断或文档规划的完整提示。
   */
  private buildInitialRunPrompt(
    kind: GenerationRunRecord['kind'],
    input: GenerationRunRecord['input'],
    template: { guidance: string, minimumBlocks: number, maximumBlocks: number },
    parameters: TextModelParameters,
    context: PromptContext,
  ): { systemPrompt: string, userPrompt: string } {
    if (kind === 'interest_assessment') {
      return buildInterestPrompt(context, 'content' in input ? input.content : '')
    }
    const allowImages = 'includeImages' in input && input.includeImages
    const maximum = Math.min(template.maximumBlocks, parameters.maxTextBlocks + (allowImages ? parameters.maxImageBlocks : 0))
    if (template.minimumBlocks > maximum) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '格式模板最少块数超过当前运行允许的图文块总数', 422)
    }
    return buildDocumentPlanPrompt(
      context,
      'requirement' in input ? input.requirement : '',
      template.guidance,
      template.minimumBlocks,
      maximum,
      allowImages,
    )
  }

  /**
   * 使用 SQLite 当前状态再次过滤提供器结果，并生成逐条预算输入。
   * @param persona 当前人物及所属世界。
   * @param candidates OpenViking 或 FTS5 排序结果。
   * @param model 当前模型名称。
   * @returns 有效候选、证据标识和被拒绝条目快照。
   */
  private async preparePromptBudgetCandidates(
    persona: PersonaRecord,
    candidates: Awaited<ReturnType<ContextProvider['search']>>['candidates'],
    model: string,
  ): Promise<PreparedPromptCandidates> {
    const [personaSources, worldSources] = await Promise.all([
      this.dependencies.content.listPersonaSources(persona.id),
      persona.worldId ? this.dependencies.content.listWorldSources(persona.worldId) : Promise.resolve([]),
    ])
    const sources = new Map([...worldSources, ...personaSources].map(item => [item.id, item]))
    const valid: PreparedPromptCandidates['valid'] = []
    const invalid: PromptContextItemSnapshot[] = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      const category = candidate.entityType === 'source' ? 'source' : candidate.entityType
      const entityId = candidate.entityType === 'source'
        ? candidate.chunkId ?? candidate.entityId
        : candidate.entityId
      const evidenceId = this.dependencies.identifiers.create()
      const estimatedTokens = this.dependencies.tokenCounter.count(
        model,
        JSON.stringify({ id: evidenceId, entityId, role: candidate.role, content: candidate.content }),
      ).tokens
      const budget: PromptBudgetCandidate = {
        entityId,
        category,
        role: candidate.role,
        content: candidate.content,
        contentHash: candidate.contentHash,
        estimatedTokens,
      }
      const uniqueKey = promptBudgetCandidateKey(budget)
      const source = candidate.sourceId ? sources.get(candidate.sourceId) : null
      const isValid = candidate.entityType === 'source'
        && Boolean(source && source.contentText.includes(candidate.content))
      if (!isValid || seen.has(uniqueKey)) {
        invalid.push(toPromptContextItemSnapshot(budget, 'scope_or_state_invalid'))
        continue
      }
      seen.add(uniqueKey)
      valid.push({
        budget,
        evidenceId,
        sourceId: candidate.sourceId,
        chunkId: candidate.chunkId,
        heading: candidate.heading,
        priority: candidate.priority,
      })
    }
    return { valid, invalid }
  }

  /** @param model 当前模型名称。 @param prompt 完整系统与用户提示。 @returns 保守或精确的合并输入 Token。 */
  private countPromptTokens(model: string, prompt: { systemPrompt: string, userPrompt: string }): number {
    return this.dependencies.tokenCounter.count(model, `${prompt.systemPrompt}\n${prompt.userPrompt}`).tokens
  }

  /** @param runId 兴趣运行 UUID。 @returns 执行结束时完成。 */
  private async executeInterest(runId: string): Promise<void> {
    const run = await this.requireRun(runId)
    this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['queued', 'running'])
    const context = await this.loadPromptContext(run)
    const prompt = buildInterestPrompt(context, 'content' in run.input ? run.input.content : '')
    const { output, usage } = await this.generateValidated(prompt, run.parameterSnapshot, 'interest_assessment', value => {
      const parsed = interestAssessmentSchema.parse(value)
      const evidenceIds = new Set(context.evidence.map(item => item.id))
      if ([...parsed.supportingEvidenceIds, ...parsed.opposingEvidenceIds].some(id => !evidenceIds.has(id))) throw new Error('兴趣判断引用了不存在的证据标识')
      return parsed
    }, run.usage)
    if (await this.finishCancellationIfRequested(runId, usage)) return
    const cumulativeUsage = aggregateTextModelUsage(run.usage ? [run.usage, usage] : [usage])
    const timestamp = this.dependencies.clock.now()
    if (!await this.dependencies.runs.completeInterestRun(runId, output, cumulativeUsage, timestamp)) throw new Error('兴趣运行状态已经变化')
    await this.recordPersonaOperation(run, output.reasoningSummary, output as Record<string, unknown>, timestamp)
  }

  /** @param runId 文档规划运行 UUID。 @returns 规划结束时完成。 */
  private async executeDocumentPlan(runId: string): Promise<void> {
    const run = await this.requireRun(runId)
    this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['planning', 'running'])
    const context = await this.loadPromptContext(run)
    const template = run.formatTemplateId ? await this.requireFormatTemplate(run.formatTemplateId) : { spec: DEFAULT_FORMAT_TEMPLATE }
    const allowImages = 'includeImages' in run.input && run.input.includeImages
    const maximum = Math.min(
      template.spec.maximumBlocks,
      run.parameterSnapshot.maxTextBlocks + (allowImages ? run.parameterSnapshot.maxImageBlocks : 0),
    )
    if (template.spec.minimumBlocks > maximum) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '格式模板最少块数超过当前运行允许的图文块总数', 422)
    }
    const prompt = buildDocumentPlanPrompt(context, 'requirement' in run.input ? run.input.requirement : '', template.spec.guidance, template.spec.minimumBlocks, maximum, allowImages)
    const { output, usage } = await this.generateValidated(prompt, run.parameterSnapshot, 'document_spec', value => {
      const parsed = documentSpecSchema.parse(value)
      if (parsed.blocks.length < template.spec.minimumBlocks || parsed.blocks.length > maximum) throw new Error('模型规划的块数量超出模板或运行限制')
      if (!allowImages && parsed.blocks.some(block => block.type === 'image')) throw new Error('当前运行未启用图片，模型不得规划图片块')
      this.validateDocumentLimits(parsed, run)
      return parsed
    }, run.usage)
    if (await this.finishCancellationIfRequested(runId, usage)) return
    const cumulativeUsage = aggregateTextModelUsage(run.usage ? [run.usage, usage] : [usage])
    if (!await this.dependencies.runs.savePlannedDocumentSpec(runId, this.dependencies.identifiers.create(), output, cumulativeUsage, this.dependencies.clock.now())) throw new Error('文档规划运行状态已经变化')
  }

  /** @param runId 已确认文档运行 UUID。 @returns 所有图文块串行执行结束时完成。 */
  private async executeDocument(runId: string): Promise<void> {
    const run = await this.requireRun(runId)
    this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['queued', 'running'])
    const context = await this.loadPromptContext(run)
    const spec = (await this.dependencies.runs.listDocumentSpecs(runId)).find(item => item.status === 'confirmed')
    if (!spec) throw new ApplicationError('DOCUMENT_SPEC_NOT_CONFIRMED', '文档规格尚未确认', 409)
    if (spec.spec.blocks.some(block => block.type === 'image')) this.requireMatchingImageModel(run)
    await this.dependencies.runs.recoverInterruptedDocumentBlocks(runId, this.dependencies.clock.now())
    const blocks = await this.dependencies.runs.listBlocks(runId)
    const previousOutputs: Array<{ key: string, text: string }> = []
    for (const block of blocks) {
      if (await this.dependencies.runs.isCancellationRequested(runId)) {
        await this.dependencies.runs.markRunCanceled(runId, this.dependencies.clock.now())
        return
      }
      if (block.status === 'succeeded' && block.selectedAttemptId) {
        await this.appendSelectedText(block, previousOutputs)
        continue
      }
      if (!dependenciesSucceeded(block, blocks)) {
        await this.recordDependencyFailure(run, block, previousOutputs)
        block.status = 'failed'
        continue
      }
      const output = await this.executeArtifactBlock(run, context, spec.spec, block, previousOutputs)
      block.status = output.succeeded ? 'succeeded' : 'failed'
      if (output.text) previousOutputs.push({ key: block.specKey, text: output.text })
    }
    const timestamp = this.dependencies.clock.now()
    const status = await this.dependencies.runs.finishDocumentRun(runId, timestamp)
    if (status !== 'failed') await this.recordPersonaOperation(run, `图文任务已${status === 'succeeded' ? '全部完成' : '部分完成'}，共处理 ${blocks.length} 个内容块。`, null, timestamp)
  }

  /** @param runId 运行 UUID。 @param blockId 目标块 UUID。 @returns 单块任务完成时结束。 */
  private async executeSingleBlock(runId: string, blockId: string): Promise<void> {
    const run = await this.requireRun(runId)
    this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['queued', 'running'])
    const context = await this.loadPromptContext(run)
    const spec = (await this.dependencies.runs.listDocumentSpecs(runId)).find(item => item.status === 'confirmed')
    if (!spec) throw new ApplicationError('DOCUMENT_SPEC_NOT_CONFIRMED', '文档规格尚未确认', 409)
    await this.dependencies.runs.recoverInterruptedDocumentBlocks(runId, this.dependencies.clock.now())
    const blocks = await this.dependencies.runs.listBlocks(runId)
    const target = blocks.find(block => block.id === blockId)
    if (!target) throw new ApplicationError('RESOURCE_NOT_FOUND', '产物块不存在', 404)
    if (target.isLocked) throw new ApplicationError('BLOCK_LOCKED', '锁定块不能重试', 409)
    if (target.type === 'image') this.requireMatchingImageModel(run)
    const previousOutputs: Array<{ key: string, text: string }> = []
    for (const block of blocks.slice(0, target.ordinal)) {
      if (block.status === 'succeeded') await this.appendSelectedText(block, previousOutputs)
    }
    if (!dependenciesSucceeded(target, blocks)) await this.recordDependencyFailure(run, target, previousOutputs)
    else await this.executeArtifactBlock(run, context, spec.spec, target, previousOutputs)
    const timestamp = this.dependencies.clock.now()
    const status = await this.dependencies.runs.finishDocumentRun(runId, timestamp)
    if (status !== 'failed') await this.recordPersonaOperation(run, `图文任务单块重试后状态为${status === 'succeeded' ? '全部完成' : '部分完成'}。`, null, timestamp)
  }

  /**
   * 把成功运行压缩为一条可审核的记忆原始处理记录。
   * @param run 完成时仍保持不变的运行快照。
   * @param resultSummary 便于检索的结果摘要。
   * @param decision 兴趣选择、评分或其他结构化结论。
   * @param timestamp 运行完成时间。
   * @returns 未配置写入端口或幂等写入完成时结束。
   */
  private async recordPersonaOperation(
    run: GenerationRunRecord,
    resultSummary: string,
    decision: Record<string, unknown> | null,
    timestamp: number,
  ): Promise<void> {
    const [identity, evidence] = await Promise.all([
      this.dependencies.runs.findRunPersona(run.id),
      this.dependencies.runs.listEvidence(run.id),
    ])
    if (!identity) throw new Error('运行绑定人物不存在')
    await this.dependencies.learning.createPersonaOperationRecord({
      id: this.dependencies.identifiers.create(),
      personaId: identity.personaId,
      runId: run.id,
      operationType: run.kind,
      resultSummary,
      decision,
      contextSnapshot: {
        personaVersionId: run.personaVersionId,
        evidence: evidence.map(item => ({ id: item.id, role: item.role, contentHash: item.contentHash })),
      },
      timestamp,
    })
  }

  /**
   * 在运行快照的累计尝试上限内执行单个文字或图片块。
   * @param run 固定运行快照。
   * @param context 固定提示上下文。
   * @param documentSpec 已确认规格。
   * @param block 目标持久块。
   * @param previousOutputs 前序成功文字块。
   * @returns 是否成功及可供后续块使用的文字。
   */
  private async executeArtifactBlock(
    run: GenerationRunRecord,
    context: PromptContext,
    documentSpec: DocumentSpec,
    block: ArtifactBlockRecord,
    previousOutputs: Array<{ key: string, text: string }>,
  ): Promise<{ succeeded: boolean, text: string | null }> {
    const existingAttempts = await this.dependencies.runs.listBlockAttempts(block.id)
    const remainingAttempts = run.parameterSnapshot.maxBlockAttempts - existingAttempts.length
    for (let attemptIndex = 0; attemptIndex < remainingAttempts; attemptIndex += 1) {
      const attemptId = this.dependencies.identifiers.create()
      const inputSnapshot = block.spec.type === 'image'
        ? { promptVersion: run.promptVersion, block: block.spec, visualBrief: block.spec.visualBrief, previousOutputs }
        : { promptVersion: run.promptVersion, block: block.spec, previousOutputs }
      const attempt = await this.dependencies.runs.startBlockAttempt(block.id, attemptId, inputSnapshot, this.dependencies.clock.now())
      if (!attempt) break
      let responseUsage: TextModelUsage | null = null
      try {
        if (block.spec.type === 'image') {
          const brief = block.spec.visualBrief
          const imagePrompt = buildImagePrompt(context, brief, previousOutputs)
          this.assertPromptCharacterLimit({ systemPrompt: '', userPrompt: imagePrompt }, run.parameterSnapshot)
          const response = await this.dependencies.imageModel.generate({
            prompt: imagePrompt,
            aspectRatio: brief.aspectRatio,
            timeoutMs: run.parameterSnapshot.timeoutMs,
          })
          const assetId = this.dependencies.identifiers.create()
          const stored = await this.dependencies.imageAssets.saveImage(run.id, assetId, response.bytes, response.declaredMediaType)
          try {
            await this.dependencies.runs.completeImageBlockAttempt(block.id, attemptId, { id: assetId, ...stored, altText: brief.altText }, this.dependencies.clock.now())
          }
          catch (error: unknown) {
            // 数据库事务失败时删除刚写入的文件，避免产生无法从业务事实定位的孤儿资产。
            await this.dependencies.imageAssets.deleteImage(run.id, stored.relativePath)
            throw error
          }
          return { succeeded: true, text: null }
        }
        const prompt = buildTextBlockPrompt(context, documentSpec, block.spec, previousOutputs)
        this.assertPromptCharacterLimit(prompt, run.parameterSnapshot)
        this.assertPromptInputBudget(prompt, run.parameterSnapshot, run.modelSnapshot.model)
        await this.assertRunTokenBudget(run, null)
        const response = await this.dependencies.model.generateStructured({ ...prompt, parameters: run.parameterSnapshot, responseSchemaName: 'text_block' })
        responseUsage = response.usage
        await this.assertRunTokenBudget(run, response.usage)
        const output = textBlockOutputSchema.parse(response.structuredOutput)
        await this.dependencies.runs.completeBlockAttempt(block.id, attemptId, output.text, response.usage, this.dependencies.clock.now())
        return { succeeded: true, text: output.text }
      }
      catch (error: unknown) {
        const normalized = normalizeExecutionError(error)
        await this.dependencies.runs.failBlockAttempt(block.id, attemptId, normalized.code, normalized.message, responseUsage, this.dependencies.clock.now())
        if (!normalized.retryable) break
      }
    }
    return { succeeded: false, text: null }
  }

  /** @param block 已成功块。 @param outputs 可变前序文字集合。 @returns 选中文字存在时追加。 */
  private async appendSelectedText(block: ArtifactBlockRecord, outputs: Array<{ key: string, text: string }>): Promise<void> {
    if (block.type !== 'text' || !block.selectedAttemptId) return
    const selected = (await this.dependencies.runs.listBlockAttempts(block.id)).find(attempt => attempt.id === block.selectedAttemptId)
    if (selected?.outputText) outputs.push({ key: block.specKey, text: selected.outputText })
  }

  /** @param run 固定运行快照。 @param block 依赖未完成块。 @param previousOutputs 前序文字。 @returns 在上限内保存一次稳定失败尝试。 */
  private async recordDependencyFailure(run: GenerationRunRecord, block: ArtifactBlockRecord, previousOutputs: Array<{ key: string, text: string }>): Promise<void> {
    if ((await this.dependencies.runs.listBlockAttempts(block.id)).length >= run.parameterSnapshot.maxBlockAttempts) return
    const attemptId = this.dependencies.identifiers.create()
    const attempt = await this.dependencies.runs.startBlockAttempt(block.id, attemptId, { promptVersion: 'dependency-check', block: block.spec, previousOutputs }, this.dependencies.clock.now())
    if (attempt) await this.dependencies.runs.failBlockAttempt(block.id, attemptId, 'DEPENDENCY_FAILED', '前置依赖块未成功，当前块未调用模型', null, this.dependencies.clock.now())
  }

  /**
   * 执行最多两次结构化调用，并累计本轮所有供应商响应的用量。
   * @param prompt 已分层提示。
   * @param parameters 固定参数。
   * @param schemaName 结构名称。
   * @param parse 结构校验器。
   * @param priorUsage 当前运行此前已保存的用量；非运行调用为空。
   * @returns 校验通过的结构和本轮新增用量。
   */
  private async generateValidated<T>(
    prompt: { systemPrompt: string, userPrompt: string },
    parameters: TextModelParameters,
    schemaName: string,
    parse: (value: unknown) => T,
    priorUsage: TextModelUsage | null = null,
  ): Promise<{ output: T, usage: TextModelUsage }> {
    let lastError: unknown
    let currentPrompt = prompt
    const usages: TextModelUsage[] = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.assertPromptCharacterLimit(currentPrompt, parameters)
        this.assertPromptInputBudget(currentPrompt, parameters, this.dependencies.model.getConfiguredModel()?.model ?? '')
        const consumedTokens = usageTotalTokens(aggregateTextModelUsage(priorUsage ? [priorUsage, ...usages] : usages))
        if (consumedTokens !== null && consumedTokens >= parameters.maxTotalTokens) {
          throw new ApplicationError('TASK_LIMIT_EXCEEDED', '模型已报告的运行总 Token 达到上限', 422)
        }
        const response = await this.dependencies.model.generateStructured({ ...currentPrompt, parameters, responseSchemaName: schemaName })
        usages.push(response.usage)
        const usage = aggregateTextModelUsage(priorUsage ? [priorUsage, ...usages] : usages)
        const totalTokens = usageTotalTokens(usage)
        if (totalTokens !== null && totalTokens > parameters.maxTotalTokens) {
          throw new TextUsageLimitError(aggregateTextModelUsage(usages))
        }
        return { output: parse(response.structuredOutput), usage: aggregateTextModelUsage(usages) }
      }
      catch (error: unknown) {
        lastError = error
        const normalized = normalizeExecutionError(error)
        if (!normalized.retryable) break
        currentPrompt = { ...prompt, userPrompt: `${prompt.userPrompt}\n\n<上次输出校验错误>${JSON.stringify(normalized.message)}</上次输出校验错误>\n请重新输出完整 JSON 对象。` }
      }
    }
    if (lastError instanceof TextResponseUsageError) throw lastError
    if (usages.length) {
      const normalized = normalizeExecutionError(lastError)
      throw new TextResponseUsageError(normalized.code, normalized.message, normalized.retryable, aggregateTextModelUsage(usages))
    }
    throw lastError
  }

  /**
   * 在调用供应商前校验系统提示与用户提示的准确字符总数。
   * @param prompt 待发送的分层提示。
   * @param parameters 固定运行参数。
   * @returns 未超过上限时无返回值。
   */
  private assertPromptCharacterLimit(prompt: { systemPrompt: string, userPrompt: string }, parameters: TextModelParameters): void {
    if (prompt.systemPrompt.length + prompt.userPrompt.length > parameters.maxPromptCharacters) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '模型提示字符数超过运行上限', 422)
    }
  }

  /**
   * 在供应商调用前校验当前完整提示不突破模型可用输入 Token。
   * @param prompt 最终系统与用户提示。
   * @param parameters 固定预算配置。
   * @param model 当前运行绑定的模型名称。
   * @returns 预算允许时无返回值。
   */
  private assertPromptInputBudget(prompt: { systemPrompt: string, userPrompt: string }, parameters: TextModelParameters, model: string): void {
    const available = parameters.contextWindowTokens - parameters.reservedOutputTokens - parameters.safetyMarginTokens
    if (this.countPromptTokens(model, prompt) > available) {
      throw new ApplicationError('PROMPT_BUDGET_EXCEEDED', '当前模型提示超过可用输入 Token', 422)
    }
  }

  /**
   * 按供应商已经报告的用量校验当前运行总 Token。
   * @param run 固定运行快照。
   * @param additionalUsage 尚未持久化的本次响应，可为空。
   * @returns 未达到或超过上限时无返回值。
   */
  private async assertRunTokenBudget(run: GenerationRunRecord, additionalUsage: TextModelUsage | null): Promise<void> {
    const persistedUsage = await this.getRunUsage(run)
    const persistedTokens = usageTotalTokens(persistedUsage)
    const additionalTokens = usageTotalTokens(additionalUsage)
    const projectedTokens = (persistedTokens ?? 0) + (additionalTokens ?? 0)
    const hasKnownUsage = persistedTokens !== null || additionalTokens !== null
    const exceeded = additionalUsage
      ? hasKnownUsage && projectedTokens > run.parameterSnapshot.maxTotalTokens
      : persistedTokens !== null && persistedTokens >= run.parameterSnapshot.maxTotalTokens
    if (exceeded) throw new ApplicationError('TASK_LIMIT_EXCEEDED', '模型已报告的运行总 Token 达到上限', 422)
  }

  /** @param run 运行记录。 @returns 规划或兴趣调用与全部已报告块用量的合计。 */
  private async getRunUsage(run: GenerationRunRecord): Promise<TextModelUsage | null> {
    const blockUsages = await this.dependencies.runs.listRunTextUsages(run.id)
    const usages = run.usage ? [run.usage, ...blockUsages] : blockUsages
    return usages.length ? aggregateTextModelUsage(usages) : null
  }

  /** @param run 固定运行。 @returns 人物、世界、场景和证据提示上下文。 */
  private async loadPromptContext(run: GenerationRunRecord): Promise<PromptContext> {
    const version = await this.requirePublishedPersonaVersion(run.personaVersionId)
    const evidence = await this.dependencies.runs.listEvidence(run.id)
    const worldEvidence = evidence.find(item => typeof item.metadata.worldVersionId === 'string')
    const world = worldEvidence ? worldSnapshotSchema.parse(JSON.parse(worldEvidence.content)) : null
    const fixedLearningPrompts = new Map(
      evidence
        .filter(item => item.metadata.fixedLearningPrompt === true && typeof item.metadata.learningPromptType === 'string')
        .map(item => [item.metadata.learningPromptType as string, item.content]),
    )
    return {
      persona: version.snapshot,
      world,
      worldGrowthPrompt: fixedLearningPrompts.get('world_growth') ?? null,
      personaGrowthPrompt: fixedLearningPrompts.get('persona_growth') ?? null,
      personaMemoryPrompt: fixedLearningPrompts.get('persona_memory') ?? null,
      scene: run.scene,
      evidence: evidence.filter(item => item.role !== 'user_setting' && item.metadata.fixedLearningPrompt !== true),
    }
  }

  /** @param id 人物 UUID。 @returns 人物。 */
  private async requirePersona(id: string): Promise<PersonaRecord> {
    const value = await this.dependencies.content.findPersona(id)
    if (!value) throw new ApplicationError('RESOURCE_NOT_FOUND', '人物不存在', 404)
    return value
  }

  /** @param id 人物版本 UUID。 @param personaId 可选所属人物 UUID。 @returns 已发布版本。 */
  private async requirePublishedPersonaVersion(id: string, personaId?: string): Promise<PersonaVersionRecord> {
    const value = await this.dependencies.content.findPersonaVersion(id)
    if (!value || value.status !== 'published' || (personaId && value.personaId !== personaId)) throw new ApplicationError('PERSONA_VERSION_NOT_ACTIVE', '人物当前版本不可用于新运行', 409)
    return value
  }

  /** @param id 运行 UUID。 @returns 运行。 */
  private async requireRun(id: string): Promise<GenerationRunRecord> {
    const value = await this.dependencies.runs.findRun(id)
    if (!value) throw new ApplicationError('RESOURCE_NOT_FOUND', '运行不存在', 404)
    return value
  }

  /** @param run 固定运行。 @returns 配置仍与运行模型快照一致时无返回值。 */
  private requireMatchingModel(run: GenerationRunRecord): void {
    const configured = this.dependencies.model.getConfiguredModel()
    if (!configured
      || configured.provider !== run.modelSnapshot.provider
      || configured.model !== run.modelSnapshot.model
      || configured.endpointOrigin !== run.modelSnapshot.endpointOrigin) {
      throw new ApplicationError('RUN_MODEL_MISMATCH', '当前文本模型配置与运行快照不一致，不能继续该运行', 409)
    }
  }

  /** @param run 固定运行。 @returns 图片模型未使用或仍与快照一致时无返回值。 */
  private requireMatchingImageModel(run: GenerationRunRecord): void {
    if (!run.imageModelSnapshot) return
    const configured = this.dependencies.imageModel.getConfiguredModel()
    if (!configured
      || configured.provider !== run.imageModelSnapshot.provider
      || configured.model !== run.imageModelSnapshot.model
      || configured.endpointOrigin !== run.imageModelSnapshot.endpointOrigin) {
      throw new ApplicationError('RUN_IMAGE_MODEL_MISMATCH', '当前图片模型配置与运行快照不一致，不能继续该运行', 409)
    }
  }

  /**
   * 完成已请求的协作取消，并在取消前保存已经收到的供应商用量。
   * @param runId 运行 UUID。
   * @param responseUsage 本轮已收到但尚未保存的供应商用量。
   * @returns 存在取消请求时完成取消并返回 true。
   */
  private async finishCancellationIfRequested(runId: string, responseUsage: TextModelUsage | null = null): Promise<boolean> {
    if (!await this.dependencies.runs.isCancellationRequested(runId)) return false
    if (responseUsage) await this.saveCumulativeRunUsage(runId, responseUsage)
    await this.dependencies.runs.markRunCanceled(runId, this.dependencies.clock.now())
    return true
  }

  /** @param runId 运行 UUID。 @param responseUsage 本轮新增供应商用量。 @returns 累计并保存后的完成信号。 */
  private async saveCumulativeRunUsage(runId: string, responseUsage: TextModelUsage): Promise<void> {
    const latest = await this.requireRun(runId)
    await this.dependencies.runs.saveRunUsage(
      runId,
      aggregateTextModelUsage(latest.usage ? [latest.usage, responseUsage] : [responseUsage]),
      this.dependencies.clock.now(),
    )
  }

  /** @param id 参数方案 UUID 或 null。 @returns 最终参数快照。 */
  private async resolveParameters(id: string | null): Promise<TextModelParameters> {
    if (!id) return { ...DEFAULT_TEXT_PARAMETERS }
    const value = await this.dependencies.runs.findParameterProfile(id)
    if (!value || !value.isActive) throw new ApplicationError('RESOURCE_NOT_FOUND', '参数方案不存在或已停用', 404)
    return value.values
  }

  /** @param id 格式模板 UUID。 @returns 有效模板。 */
  private async requireFormatTemplate(id: string) {
    const value = await this.dependencies.runs.findFormatTemplate(id)
    if (!value || !value.isActive) throw new ApplicationError('RESOURCE_NOT_FOUND', '格式模板不存在或已停用', 404)
    return value
  }

  /** @param run 运行。 @param expected 可执行起始状态。 @returns 状态切换完成时结束。 */
  private async requireRunStarted(run: GenerationRunRecord, expected: GenerationRunRecord['status'][]): Promise<void> {
    if (!await this.dependencies.runs.markRunRunning(run.id, expected, this.dependencies.clock.now())) throw new Error('运行状态不允许执行当前任务')
  }

  /** @param spec 文档规格。 @param run 固定运行参数。 @returns 无返回值。 */
  private validateDocumentLimits(spec: DocumentSpec, run: GenerationRunRecord): void {
    documentSpecSchema.parse(spec)
    const textBlocks = spec.blocks.filter(block => block.type === 'text').length
    const imageBlocks = spec.blocks.length - textBlocks
    if (textBlocks > run.parameterSnapshot.maxTextBlocks) throw new ApplicationError('TASK_LIMIT_EXCEEDED', '文字块数量超过运行上限', 422)
    if (imageBlocks > run.parameterSnapshot.maxImageBlocks) throw new ApplicationError('TASK_LIMIT_EXCEEDED', '图片块数量超过运行上限', 422)
    if (spec.blocks.some(block => block.type === 'image')) {
      if (!('includeImages' in run.input) || !run.input.includeImages || !run.imageModelSnapshot) {
        throw new ApplicationError('CAPABILITY_DISABLED', '当前运行没有启用图片能力，不能加入图片块', 422)
      }
      this.requireMatchingImageModel(run)
    }
  }

  /** @param runId 运行 UUID。 @returns 已确认规格及同一组选中成功块。 */
  private async loadSelectedArtifact(runId: string): Promise<{ spec: DocumentSpec, blocks: SelectedArtifactBlock[] }> {
    await this.requireRun(runId)
    const spec = (await this.dependencies.runs.listDocumentSpecs(runId)).find(item => item.status === 'confirmed')
    if (!spec) throw new ApplicationError('DOCUMENT_SPEC_NOT_CONFIRMED', '文档规格尚未确认', 409)
    const [blocks, assets] = await Promise.all([
      this.dependencies.runs.listBlocks(runId),
      this.dependencies.runs.listImageAssets(runId),
    ])
    const assetsByAttempt = new Map(assets.map(asset => [asset.attemptId, asset]))
    const selected: SelectedArtifactBlock[] = []
    for (const block of blocks) {
      if (!block.selectedAttemptId) continue
      const attempt = (await this.dependencies.runs.listBlockAttempts(block.id))
        .find(item => item.id === block.selectedAttemptId && item.status === 'succeeded')
      if (!attempt) continue
      const asset = assetsByAttempt.get(attempt.id) ?? null
      if (block.type === 'text' && !attempt.outputText) continue
      if (block.type === 'image' && !asset) continue
      selected.push({ block, outputText: attempt.outputText, asset })
    }
    if (selected.length === 0) throw new ApplicationError('ARTIFACT_EMPTY', '当前没有可渲染的成功块', 409)
    return { spec: spec.spec, blocks: selected }
  }

  /** @param run 运行记录。 @returns 带人物身份的公开摘要。 */
  private async toRunSummary(run: GenerationRunRecord): Promise<RunSummary> {
    const identity = await this.dependencies.runs.findRunPersona(run.id)
    if (!identity) throw new Error('运行人物关系损坏')
    return { id: run.id, kind: run.kind, personaVersionId: run.personaVersionId, ...identity, status: run.status, input: run.input, scene: run.scene, parameters: run.parameterSnapshot, model: run.modelSnapshot, imageModel: run.imageModelSnapshot, promptVersion: run.promptVersion, contextProvider: run.contextProvider, promptContext: run.promptContextSnapshot, result: run.result, usage: await this.getRunUsage(run), errorCode: run.errorCode, errorMessage: run.errorMessage, createdAt: run.createdAt, updatedAt: run.updatedAt, completedAt: run.completedAt }
  }
}

/** 已通过 SQLite 范围和状态复核的提示候选集合。 */
interface PreparedPromptCandidates {
  /** 可参与预算选择并携带最终证据标识的候选。 */
  valid: Array<{
    budget: PromptBudgetCandidate
    evidenceId: string
    sourceId: string | null
    chunkId: string | null
    heading: string | null
    priority: number
  }>
  /** 因范围、状态、正文变化或重复被拒绝的候选。 */
  invalid: PromptContextItemSnapshot[]
}

/**
 * 统计可选已发布学习提示词正文的 Token。
 * @param tokenCounter 当前运行使用的 Token 计数器。
 * @param model 当前文本模型名称。
 * @param promptText 已发布完整提示词；尚未发布时为空。
 * @returns 与 Token 计数器一致的计数结果；空提示词固定返回零。
 */
function countOptionalPrompt(tokenCounter: TokenCounter, model: string, promptText: string | undefined): ReturnType<TokenCounter['count']> {
  return promptText
    ? tokenCounter.count(model, promptText)
    : { tokens: 0, mode: 'estimated', counter: 'none' }
}

/**
 * 把已发布学习提示词转换为运行证据和预算快照，确保后续执行始终读取创建运行时的固定版本。
 * @param evidenceId 新证据 UUID。
 * @param version 已发布学习提示词版本；尚未发布时为空。
 * @param category 学习提示词业务类型和预算分类。
 * @param role 证据角色。
 * @param estimatedTokens 创建运行时估算的 Token 数。
 * @param sourceProcessor 正文哈希处理器。
 * @returns 可原子写入的固定证据与审计快照；无版本时返回 null。
 */
function toFixedLearningPromptEvidence(
  evidenceId: string,
  version: LearningPromptVersionView | null,
  category: Exclude<PromptContextCategory, 'source'>,
  role: 'growth' | 'memory',
  estimatedTokens: number,
  sourceProcessor: SourceContentProcessor,
): { evidence: NewEvidenceSnapshot, snapshot: PromptContextItemSnapshot } | null {
  if (!version) return null
  const contentHash = sourceProcessor.hash(version.promptText)
  return {
    evidence: {
      id: evidenceId,
      sourceId: null,
      chunkId: null,
      role,
      content: version.promptText,
      contentHash,
      rank: 0,
      metadata: {
        fixedLearningPrompt: true,
        learningPromptType: category,
        learningPromptVersionId: version.id,
        category,
        entityId: version.id,
      },
    },
    snapshot: {
      entityId: version.id,
      category,
      role,
      contentHash,
      estimatedTokens,
      skippedReason: null,
    },
  }
}

/** @param candidate 预算候选。 @returns 可区分同一资料不同切片正文的稳定键。 */
function promptBudgetCandidateKey(candidate: PromptBudgetCandidate): string {
  return `${candidate.category}:${candidate.entityId}:${candidate.contentHash}`
}

/**
 * 转换运行预算快照条目。
 * @param candidate 已估算候选。
 * @param skippedReason 跳过原因；选中时为空。
 * @returns 不包含正文的可审计快照。
 */
function toPromptContextItemSnapshot(
  candidate: PromptBudgetCandidate,
  skippedReason: PromptContextItemSnapshot['skippedReason'],
): PromptContextItemSnapshot {
  return {
    entityId: candidate.entityId,
    category: candidate.category,
    role: candidate.role,
    contentHash: candidate.contentHash,
    estimatedTokens: candidate.estimatedTokens,
    skippedReason,
  }
}

/** @param payloadJson 任务载荷 JSON。 @returns 运行 UUID。 */
function readRunId(payloadJson: string): string {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  if (typeof value.runId !== 'string') throw new Error('任务载荷缺少运行标识')
  return value.runId
}

/** @param payloadJson 任务载荷 JSON。 @returns 单块任务 UUID。 */
function readBlockId(payloadJson: string): string {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  if (typeof value.blockId !== 'string') throw new Error('任务载荷缺少块标识')
  return value.blockId
}

/** @param block 目标块。 @param blocks 同文档块快照。 @returns 全部显式依赖是否成功。 */
function dependenciesSucceeded(block: ArtifactBlockRecord, blocks: ArtifactBlockRecord[]): boolean {
  return block.spec.dependsOn.every(key => blocks.find(candidate => candidate.specKey === key)?.status === 'succeeded')
}

/** @param spec 已确认规格。 @param formats 请求格式。 @returns 全部格式已在规格中请求时无返回值。 */
function assertFormatsRequested(spec: DocumentSpec, formats: ArtifactFormat[]): void {
  if (formats.length === 0 || new Set(formats).size !== formats.length || formats.some(format => !spec.requestedFormats.includes(format))) {
    throw new ApplicationError('FORMAT_NOT_REQUESTED', '目标格式不在已确认文档规格中', 422)
  }
}

/** @param error 未知执行异常。 @returns 稳定错误码和脱敏消息。 */
function normalizeExecutionError(error: unknown): { code: string, message: string, retryable: boolean } {
  if (error instanceof TextResponseUsageError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof TextModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ImageModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ImageAssetError) return { code: error.code, message: error.message, retryable: error.code === 'IMAGE_OUTPUT_INVALID' }
  if (error instanceof StorageCapacityError) return { code: 'INSUFFICIENT_STORAGE', message: error.message, retryable: false }
  if (error instanceof ApplicationError) return { code: error.code, message: error.message, retryable: false }
  if (error instanceof ZodError) return { code: 'MODEL_OUTPUT_INVALID', message: '模型结构化输出未通过校验', retryable: true }
  return { code: 'RUN_EXECUTION_FAILED', message: error instanceof Error ? error.message.slice(0, 500) : '运行执行失败', retryable: true }
}

/** @param role 资料业务角色。 @returns 数值越小表示人物草稿提示中的事实优先级越高。 */
function sourceRoleRank(role: 'canon_fact' | 'reference' | 'style_sample'): number {
  if (role === 'canon_fact') return 0
  if (role === 'reference') return 1
  return 2
}

/** @param usages 一次或多次供应商响应的用量。 @returns 各字段严格合计，任一响应缺字段时该合计为 null。 */
function aggregateTextModelUsage(usages: TextModelUsage[]): TextModelUsage {
  return {
    inputTokens: sumUsageField(usages.map(usage => usage.inputTokens)),
    outputTokens: sumUsageField(usages.map(usage => usage.outputTokens)),
    totalTokens: sumUsageField(usages.map(usage => usage.totalTokens)),
  }
}

/** @param values 同一用量字段的序列。 @returns 全部已知时的总和，否则为 null。 */
function sumUsageField(values: Array<number | null>): number | null {
  return values.every((value): value is number => value !== null)
    ? values.reduce((total, value) => total + value, 0)
    : null
}

/** @param usage 供应商用量。 @returns 总 Token，或在供应商只给出输入与输出时计算的总和。 */
function usageTotalTokens(usage: TextModelUsage | null): number | null {
  if (!usage) return null
  if (usage.totalTokens !== null) return usage.totalTokens
  return usage.inputTokens !== null && usage.outputTokens !== null
    ? usage.inputTokens + usage.outputTokens
    : null
}

/** 携带本轮已产生供应商用量的模型执行错误。 */
class TextResponseUsageError extends Error {
  /**
   * @param code 稳定错误码。
   * @param message 已脱敏错误原因。
   * @param retryable 是否允许任务级有限重试。
   * @param usage 本轮已产生但尚未保存的供应商用量。
   */
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly usage: TextModelUsage,
  ) {
    super(message)
    this.name = 'TextResponseUsageError'
  }
}

/** 携带已产生供应商用量的不可重试 Token 门禁错误。 */
class TextUsageLimitError extends TextResponseUsageError {
  /** @param usage 触发门禁前本轮已产生的供应商用量。 */
  constructor(usage: TextModelUsage) {
    super('TASK_LIMIT_EXCEEDED', '模型已报告的总 Token 超过运行上限', false, usage)
    this.name = 'TextUsageLimitError'
  }
}
