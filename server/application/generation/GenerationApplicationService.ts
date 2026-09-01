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
  articleImagesOutputSchema,
  articleOutputSchema,
  createGenerationRunSchema,
  createInterestBatchSchema,
  createInterestRunSchema,
  documentSpecSchema,
  interestAssessmentSchema,
  interestBatchModelOutputSchema,
  interestBatchResultItemSchema,
  textModelParametersSchema,
  textBlockOutputSchema,
  type ArtifactFormat,
  type ArticleImagesOutput,
  type ArticleOutput,
  type ArtifactOutputFormat,
  type CreateFormatTemplateInput,
  type CreateGenerationRunInput,
  type CreateInterestRunInput,
  type CreateInterestBatchInput,
  type CreateParameterProfileInput,
  type DocumentSpec,
  type TextModelParameters,
} from '../../../shared/schemas/generation'
import type {
  CreatedRun,
  CreatedInterestBatch,
  FormatTemplateView,
  InterestBatchView,
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
import type { ArtifactBlockRecord, GenerationAlgorithmSnapshot, GenerationRunRecord, TextModelUsage } from '../../domain/generation/GenerationModels'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
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
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import type { AiAlgorithmApplicationService } from '../aiConfiguration/AiAlgorithmApplicationService'
import {
  buildArticleImagesPromptVariables,
  buildArticlePromptVariables,
  buildImagePromptVariables,
  buildInterestBatchPromptVariables,
  buildInterestPromptVariables,
  buildPersonaDraftPromptVariables,
  buildTextBlockPromptVariables,
  buildWorldDraftPromptVariables,
  GENERATION_PROMPT_CODES,
  type PromptContext,
} from './PromptBuilder'
import { renderArtifact, type SelectedArtifactBlock } from './ArtifactRenderer'
import { packageArtifact, type ExportedArtifact } from './ArtifactPackager'

/** 新运行使用并保存到快照的代码固定安全参数。 */
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
  /** 全站已发布 AI 提示词目录。 */
  prompts: Pick<AiPromptApplicationService, 'render' | 'snapshotPublishedVersions'>
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
  /** 新 AI 操作使用的固定算法；未提供时仅供迁移前独立测试和历史运行兼容。 */
  algorithms?: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep' | 'executeImageStep'>
}

/** 编排运行创建、查询、文章直出、内部结果保存和 Worker 模型执行。 */
export class GenerationApplicationService implements TaskHandler {
  /** @param dependencies 运行、内容、检索、模型、标识、时间和哈希端口。 */
  constructor(private readonly dependencies: GenerationApplicationServiceDependencies) { }

  /**
   * 按当前固定算法配置返回非敏感外部能力和实际上下文提供器。
   * @returns 创作、配图和兴趣算法的真实可用状态；迁移前测试使用旧模型能力。
   */
  async getCapabilities(): Promise<SystemCapabilitiesResult> {
    const [articleAlgorithm, revisionAlgorithm, imageAnalysisAlgorithm, imageGenerationAlgorithm, interestAlgorithm] = this.dependencies.algorithms
      ? await Promise.all([
          this.prepareCapabilityAlgorithm('article_generation'),
          this.prepareCapabilityAlgorithm('article_text_revision'),
          this.prepareCapabilityAlgorithm('article_image_analysis'),
          this.prepareCapabilityAlgorithm('article_image_generation'),
          this.prepareCapabilityAlgorithm('interest_assessment'),
        ])
      : [null, null, null, null, null]
    const legacyTextModel = this.dependencies.algorithms ? null : this.dependencies.model.getConfiguredModel()
    const legacyImageModel = this.dependencies.algorithms ? null : this.dependencies.imageModel.getConfiguredModel()
    const articleGeneration = Boolean(articleAlgorithm && revisionAlgorithm) || Boolean(legacyTextModel)
    const articleImageGeneration = Boolean(imageAnalysisAlgorithm && imageGenerationAlgorithm) || Boolean(legacyImageModel)
    const interestAssessment = Boolean(interestAlgorithm) || Boolean(legacyTextModel)
    const textStep = articleGeneration
      ? articleAlgorithm?.steps.find(step => step.modality === 'text') ?? null
      : interestAlgorithm?.steps.find(step => step.modality === 'text') ?? null
    const imageStep = articleImageGeneration
      ? imageGenerationAlgorithm?.steps.find(step => step.modality === 'image') ?? null
      : null
    const textModel = textStep
      ? { configured: true as const, provider: 'openai_compatible' as const, model: textStep.model, endpointOrigin: new URL(textStep.endpoint).origin }
      : legacyTextModel
        ? { configured: true as const, ...legacyTextModel }
        : { configured: false as const, provider: 'openai_compatible' as const, model: null, endpointOrigin: null }
    const imageModel = imageStep
      ? { configured: true as const, provider: 'openai_compatible_images' as const, model: imageStep.model, endpointOrigin: new URL(imageStep.endpoint).origin }
      : legacyImageModel
        ? { configured: true as const, ...legacyImageModel }
        : { configured: false as const, provider: 'openai_compatible_images' as const, model: null, endpointOrigin: null }
    const openViking = this.dependencies.context.getOpenVikingCapability()
    return {
      textModel,
      imageModel,
      algorithmCapabilities: { articleGeneration, articleImageGeneration, interestAssessment },
      openViking,
      contextProvider: this.dependencies.context.getProvider(),
      defaultParameters: { ...DEFAULT_TEXT_PARAMETERS },
    }
  }

  /**
   * 尝试准备一个用于能力展示的固定算法，不把未配置或配置失效提升为系统接口错误。
   * @param code 当前工作台实际依赖的固定算法编码。
   * @returns 可执行算法快照；算法尚未配置或当前依赖失效时返回 null。
   */
  private async prepareCapabilityAlgorithm(code: AiAlgorithmSnapshot['algorithmCode']): Promise<AiAlgorithmSnapshot | null> {
    try {
      return await this.dependencies.algorithms!.prepare(code)
    }
    catch (error: unknown) {
      if (error instanceof ApplicationError) return null
      throw error
    }
  }

  /**
   * 把自然语言、可选世界和参考资料整理为待人工确认的人物草稿。
   * @param input 已校验的草稿生成输入。
   * @returns 不写入数据库的结构化草稿及非阻断截断提示。
   */
  async generatePersonaDraft(input: GeneratePersonaDraftInput): Promise<PersonaDraftView> {
    if (!this.dependencies.algorithms && !this.dependencies.model.getConfiguredModel()) {
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

    const variables = buildPersonaDraftPromptVariables(input.prompt, world, sources)
    try {
      const output = this.dependencies.algorithms
        ? personaDraftSchema.parse((await this.dependencies.algorithms.executeStep(
            await this.dependencies.algorithms.prepare('persona_draft'),
            'generate', variables, 'persona_draft', 'json_object',
          )).structuredOutput)
        : (await this.generateValidated(
            await this.dependencies.prompts.render(GENERATION_PROMPT_CODES.personaDraft, variables),
            (await this.dependencies.prompts.snapshotPublishedVersions([GENERATION_PROMPT_CODES.jsonRetry]))[GENERATION_PROMPT_CODES.jsonRetry]!,
            { ...DEFAULT_TEXT_PARAMETERS },
            'persona_draft',
            value => personaDraftSchema.parse(value),
          )).output
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
    if (!this.dependencies.algorithms && !this.dependencies.model.getConfiguredModel()) {
      throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置，不能生成世界草稿', 422)
    }
    try {
      const variables = buildWorldDraftPromptVariables(input.prompt)
      return this.dependencies.algorithms
        ? worldDraftSchema.parse((await this.dependencies.algorithms.executeStep(
            await this.dependencies.algorithms.prepare('world_draft'),
            'generate', variables, 'world_draft', 'json_object',
          )).structuredOutput)
        : (await this.generateValidated(
            await this.dependencies.prompts.render(GENERATION_PROMPT_CODES.worldDraft, variables),
            (await this.dependencies.prompts.snapshotPublishedVersions([GENERATION_PROMPT_CODES.jsonRetry]))[GENERATION_PROMPT_CODES.jsonRetry]!,
            { ...DEFAULT_TEXT_PARAMETERS },
            'world_draft',
            value => worldDraftSchema.parse(value),
          )).output
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
    const normalized = createInterestRunSchema.parse(input)
    const batch = await this.createInterestBatch({
      personaId: normalized.personaId,
      additionalPrompt: normalized.additionalPrompt,
      items: [{ itemId: 'item-1', text: normalized.content }],
    }, normalized.scene ?? null)
    const item = batch.items[0]
    if (!item) throw new Error('单条兴趣批次缺少运行条目')
    const task = await this.dependencies.runs.listRunTasks(item.runId)
    const firstTask = task[0]
    if (!firstTask) throw new Error('单条兴趣批次缺少主任务')
    return { runId: item.runId, taskId: firstTask.id, status: 'queued' }
  }

  /**
   * 创建同一人物的一次批量兴趣判定，并只排入一个主模型任务。
   * @param input 已校验或待规范化的人物及顺序文本列表。
   * @param scene 仅供兼容 v1 单条接口使用的临时场景。
   * @returns 批次 UUID 与严格保持输入顺序的独立运行 UUID。
   */
  async createInterestBatch(input: CreateInterestBatchInput, scene: GenerationRunRecord['scene'] = null): Promise<CreatedInterestBatch> {
    const normalized = createInterestBatchSchema.parse(input)
    return await this.createPreparedInterestBatch(normalized, scene)
  }

  /**
   * 查询兴趣批次，并由各独立运行的当前状态派生批次状态。
   * @param batchId 兴趣批次 UUID。
   * @returns 按输入顺序排列的当前批次视图。
   */
  async getInterestBatch(batchId: string): Promise<InterestBatchView> {
    const batch = await this.dependencies.runs.findInterestBatch(batchId)
    if (!batch) throw new ApplicationError('RESOURCE_NOT_FOUND', '兴趣批次不存在', 404)
    const items = batch.items.map(({ itemId, run }) => ({
      itemId,
      runId: run.id,
      text: 'content' in run.input ? run.input.content : '',
      status: normalizeInterestItemStatus(run.status),
      decision: run.result?.decision ?? null,
      probability: run.result?.probability ?? null,
      confidence: run.result?.confidence ?? null,
      reason: run.result?.reasoningSummary ?? null,
      error: run.errorCode
        ? { code: run.errorCode, message: run.errorMessage ?? '兴趣判定失败' }
        : run.status === 'canceled' ? { code: 'RUN_CANCELED', message: '兴趣判定已取消' } : null,
    }))
    const status = items.every(item => item.status === 'succeeded' || item.status === 'failed')
      ? 'completed' as const
      : items.some(item => item.status === 'running') ? 'running' as const : 'queued' as const
    const persona = await this.dependencies.content.findPersona(batch.personaId)
    const firstRun = batch.items[0]?.run
    const additionalPrompt = firstRun && 'content' in firstRun.input ? firstRun.input.additionalPrompt ?? '' : ''
    return {
      batchId: batch.id,
      personaId: batch.personaId,
      personaName: persona?.name ?? '已删除人物',
      additionalPrompt,
      status,
      items,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    }
  }

  /**
   * 仅重试兴趣批次中一个失败条目，不携带上次模型回答。
   * @param batchId 兴趣批次 UUID。
   * @param itemId 客户端稳定条目标识。
   * @returns 已重新排队后的完整批次视图。
   */
  async retryInterestBatchItem(batchId: string, itemId: string): Promise<InterestBatchView> {
    if (!await this.dependencies.runs.retryInterestBatchItem(
      batchId, itemId, this.dependencies.identifiers.create(), this.dependencies.clock.now(),
    )) throw new ApplicationError('RUN_NOT_RETRYABLE', '兴趣条目不存在或当前状态不能重试', 409)
    return await this.getInterestBatch(batchId)
  }

  /** @param input 一次直出文章输入。 @returns 处于文章生成状态的运行与任务标识。 */
  async createGenerationRun(input: CreateGenerationRunInput): Promise<CreatedRun> {
    const normalized = createGenerationRunSchema.parse(input)
    return await this.createRun('artifact_generation', normalized.personaId, {
      requirement: normalized.requirement,
      outputFormat: normalized.outputFormat,
      imageCount: normalized.imageCount,
    }, null)
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
          return {
            ...attempt,
            asset: asset
              ? {
                  id: asset.id, relativePath: asset.relativePath, mediaType: asset.mediaType,
                  sizeBytes: asset.sizeBytes, contentHash: asset.contentHash, altText: asset.altText,
                  original: asset.original,
                }
              : null,
          }
        }),
      }))),
      tasks,
    }
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
    if (run.interestAlgorithmSnapshot) {
      const batchItem = await this.dependencies.runs.findInterestBatchItemByRun(runId)
      if (!batchItem) throw new ApplicationError('RESOURCE_NOT_FOUND', '兴趣运行所属批次不存在', 404)
      const taskId = this.dependencies.identifiers.create()
      if (!await this.dependencies.runs.retryInterestBatchItem(
        batchItem.batchId, batchItem.itemId, taskId, this.dependencies.clock.now(),
      )) throw new ApplicationError('VERSION_CONFLICT', '运行状态已经变化，请刷新后重试', 409)
      return { runId, taskId, status: 'queued' }
    }
    if (!run.algorithmSnapshot?.articleTextRevision) this.requireMatchingModel(run)
    if (!run.algorithmSnapshot?.articleImageGeneration) this.requireMatchingImageModel(run)
    const taskId = this.dependencies.identifiers.create()
    const retried = await this.dependencies.runs.retryRun(runId, taskId, this.dependencies.clock.now())
    if (!retried) throw new ApplicationError('VERSION_CONFLICT', '运行状态已经变化，请刷新后重试', 409)
    return { runId, taskId, status: retried.status }
  }

  /** @param runId 运行 UUID。 @param formats 目标格式。 @returns 同一组选中块的安全预览。 */
  async renderRun(runId: string, formats: ArtifactFormat[]): Promise<RenderedArtifactView> {
    const selected = await this.loadSelectedArtifact(runId)
    assertFormatsRequested(selected.spec, formats)
    return {
      runId,
      documents: renderArtifact(selected.spec, selected.blocks, formats),
      assets: selected.blocks.flatMap(item => item.asset
        ? [{
            id: item.asset.id, relativePath: item.asset.relativePath, mediaType: item.asset.mediaType,
            sizeBytes: item.asset.sizeBytes, contentHash: item.asset.contentHash, altText: item.asset.altText,
            original: item.asset.original,
          }]
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

  /**
   * 读取最终图片或发生二次裁剪时保留的原图。
   * @param runId 运行 UUID。
   * @param assetId 图片资产 UUID。
   * @param variant 最终裁剪结果或裁剪前原图。
   * @returns 已授权运行内的图片字节与类型。
   */
  async getImageAsset(
    runId: string,
    assetId: string,
    variant: 'result' | 'original' = 'result',
  ): Promise<{ bytes: Uint8Array, mediaType: string }> {
    await this.requireRun(runId)
    const asset = await this.dependencies.runs.findImageAsset(runId, assetId)
    if (!asset) throw new ApplicationError('RESOURCE_NOT_FOUND', '图片资产不存在', 404)
    const selected = variant === 'original' ? asset.original : asset
    if (!selected) throw new ApplicationError('RESOURCE_NOT_FOUND', '当前图片未发生裁剪，没有独立原图资产', 404)
    try {
      return { bytes: await this.dependencies.imageAssets.readImage(runId, selected.relativePath), mediaType: selected.mediaType }
    }
    catch (error: unknown) {
      if (error instanceof ImageAssetError) throw new ApplicationError(error.code, error.message, error.code === 'ASSET_NOT_FOUND' ? 404 : 400)
      throw error
    }
  }

  /** @param job Worker 已领取任务。 @returns 业务执行结束时完成。 */
  async execute(job: TaskJob): Promise<void> {
    const runId = readRunId(job.payloadJson)
    const batchId = readOptionalPayloadString(job.payloadJson, 'batchId')
    const itemId = readOptionalPayloadString(job.payloadJson, 'itemId')
    try {
      if (job.type === 'assess_interest' && batchId) await this.executeInterestBatch(batchId, itemId)
      else if (job.type === 'assess_interest') await this.executeInterest(runId)
      else if (job.type === 'plan_document') await this.executeDocumentPlan(runId)
      else if (job.type === 'execute_document') await this.executeDocument(runId)
      else if (job.type === 'execute_block') {
        await this.executeSingleBlock(runId, readBlockId(job.payloadJson), readCorrectionInstruction(job.payloadJson))
      }
      else throw new Error(`未注册任务类型：${job.type}`)
      if (!batchId) await this.enqueueRunSessionIfTerminal(runId)
    }
    catch (error: unknown) {
      const responseUsage = error instanceof TextResponseUsageError ? error.usage : null
      if (await this.finishCancellationIfRequested(runId, responseUsage)) return
      if (responseUsage) {
        await this.saveCumulativeRunUsage(runId, responseUsage)
        if (batchId) await this.dependencies.runs.saveInterestBatchUsage(batchId, responseUsage, this.dependencies.clock.now())
      }
      const normalized = normalizeExecutionError(error)
      const willRetry = normalized.retryable && job.attemptCount < job.maxAttempts
      if (willRetry) {
        if (batchId) await this.dependencies.runs.prepareInterestBatchRetry(batchId, itemId, this.dependencies.clock.now())
        else await this.dependencies.runs.prepareAutomaticRetry(runId, job.type, this.dependencies.clock.now())
      }
      else {
        if (batchId) {
          await this.dependencies.runs.failPendingInterestBatch(batchId, normalized.code, normalized.message, this.dependencies.clock.now())
        }
        else {
          await this.dependencies.runs.failRun(runId, normalized.code, normalized.message, this.dependencies.clock.now())
          await this.enqueueRunSessionIfTerminal(runId)
        }
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

  /**
   * 固定批量兴趣算法、人物心智、统一证据和全部独立运行后原子入队。
   * @param input 已规范化且编号唯一的顺序文本列表。
   * @param scene 兼容 v1 单条兴趣接口的本次场景。
   * @returns 批次及全部排队运行标识。
   */
  private async createPreparedInterestBatch(
    input: ReturnType<typeof createInterestBatchSchema.parse>,
    scene: GenerationRunRecord['scene'],
  ): Promise<CreatedInterestBatch> {
    if (!this.dependencies.algorithms) throw new ApplicationError('AI_ALGORITHM_NOT_CONFIGURED', '兴趣判定算法服务未配置', 422)
    const interestAlgorithm = await this.dependencies.algorithms.prepare('interest_assessment')
    const step = interestAlgorithm.steps.find(item => item.stepKey === 'assess')
    if (!step) throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '兴趣判定算法步骤不存在', 409)
    const parameters = textModelParametersSchema.parse({
      ...DEFAULT_TEXT_PARAMETERS,
      ...step.parameters,
    })
    const model = {
      provider: 'openai_compatible' as const,
      model: step.model,
      endpointOrigin: new URL(step.endpoint).origin,
    }
    const persona = await this.requirePersona(input.personaId)
    if (!persona.isEnabled) throw new ApplicationError('RESOURCE_DISABLED', '人物已禁用，不能创建新任务', 409)
    if (!persona.activeVersionId) throw new ApplicationError('PERSONA_VERSION_NOT_ACTIVE', '人物当前灵魂版本缺失，请重新保存灵魂提示词', 409)
    const version = await this.requirePublishedPersonaVersion(persona.activeVersionId, persona.id)
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
    let contextSearch
    try {
      contextSearch = await this.dependencies.context.search({
        personaId: input.personaId,
        worldId: effectivePersona.worldId,
        query: input.items.map(item => item.text).join('\n'),
        limit: parameters.maxEvidenceChunks,
      })
    }
    catch (error: unknown) {
      if (error instanceof ContextProviderError) throw new ApplicationError('PROVIDER_UNAVAILABLE', error.message, 503)
      throw error
    }
    const batchId = this.dependencies.identifiers.create()
    const taskId = this.dependencies.identifiers.create()
    const timestamp = this.dependencies.clock.now()
    const promptVersions = { [GENERATION_PROMPT_CODES.interestAssessment]: step.promptVersionId }
    const emptyContext: PromptContext = {
      persona: version.snapshot,
      world: activeWorldVersion?.snapshot ?? null,
      worldGrowthPrompt: worldGrowthVersion?.promptText ?? null,
      personaGrowthPrompt: personaGrowthVersion?.promptText ?? null,
      personaMemoryPrompt: personaMemoryVersion?.promptText ?? null,
      scene: input.additionalPrompt || scene,
      evidence: [],
    }
    const fixedPrompt = await this.dependencies.prompts.render(
      GENERATION_PROMPT_CODES.interestAssessment,
      buildInterestBatchPromptVariables(emptyContext, input.items),
      step.promptVersionId,
    )
    const fixedInputTokens = this.countPromptTokens(step.model, fixedPrompt)
    const worldSoulCount = activeWorldVersion
      ? this.dependencies.tokenCounter.count(step.model, activeWorldVersion.snapshot.promptText)
      : { tokens: 0, mode: 'estimated' as const, counter: 'none' }
    const personaSoulCount = this.dependencies.tokenCounter.count(step.model, version.snapshot.promptText)
    const worldGrowthCount = countOptionalPrompt(this.dependencies.tokenCounter, step.model, worldGrowthVersion?.promptText)
    const personaGrowthCount = countOptionalPrompt(this.dependencies.tokenCounter, step.model, personaGrowthVersion?.promptText)
    const personaMemoryCount = countOptionalPrompt(this.dependencies.tokenCounter, step.model, personaMemoryVersion?.promptText)
    const prepared = await this.preparePromptBudgetCandidates(effectivePersona, contextSearch.candidates, step.model)
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
        metadata: {
          heading: item.heading,
          priority: item.priority,
          category: item.budget.category,
          entityId: item.budget.entityId,
          promptEvidenceId: item.evidenceId,
        },
      }))
    const firstInput = input.items[0]
    if (!firstInput) throw new ApplicationError('VALIDATION_FAILED', '至少需要一条待判断文本', 422)
    const promptContext: PromptContext = {
      ...emptyContext,
      evidence: selectedEvidence.map(item => ({ ...item, runId: firstInput.itemId, createdAt: timestamp })),
    }
    const initialPrompt = await this.dependencies.prompts.render(
      GENERATION_PROMPT_CODES.interestAssessment,
      buildInterestBatchPromptVariables(promptContext, input.items),
      step.promptVersionId,
    )
    const estimatedInputTokens = this.countPromptTokens(step.model, initialPrompt)
    if (estimatedInputTokens > selection.availableInputTokens) {
      throw new ApplicationError('PROMPT_BUDGET_EXCEEDED', '最终提示词超过可用输入 Token，请减少批次文本或上下文预算', 422)
    }
    const userSettingContent = JSON.stringify(version.snapshot)
    const userSettings: NewEvidenceSnapshot[] = [{
      id: this.dependencies.identifiers.create(), sourceId: null, chunkId: null, role: 'user_setting',
      content: userSettingContent, contentHash: this.dependencies.sourceProcessor.hash(userSettingContent),
      rank: 0, metadata: { personaVersionId: version.id },
    }]
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
    const evidence = [
      ...userSettings,
      ...fixedLearningPrompts.map((item, index) => ({ ...item.evidence, rank: userSettings.length + index })),
      ...selectedEvidence.map(item => ({ ...item, rank: item.rank + userSettings.length + fixedLearningPrompts.length })),
    ]
    const promptContextSnapshot: PromptContextSnapshot = {
      aiPromptVersions: promptVersions,
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
      selected: [
        ...fixedLearningPrompts.map(item => item.snapshot),
        ...selection.selected.map(candidate => toPromptContextItemSnapshot(candidate, null)),
      ],
      skipped: [
        ...selection.skipped.map(candidate => toPromptContextItemSnapshot(candidate, candidate.skippedReason)),
        ...prepared.invalid,
      ],
      systemPromptHash: this.dependencies.sourceProcessor.hash(initialPrompt.systemPrompt),
      userPromptHash: this.dependencies.sourceProcessor.hash(initialPrompt.userPrompt),
    }
    const runs = input.items.map((item, ordinal) => {
      const runId = this.dependencies.identifiers.create()
      const runEvidence = ordinal === 0
        ? evidence
        : evidence.map(value => ({ ...value, id: this.dependencies.identifiers.create() }))
      return {
        itemId: item.itemId,
        ordinal,
        run: {
          runId,
          kind: 'interest_assessment' as const,
          personaVersionId: version.id,
          formatTemplateId: null,
          parameterProfileId: null,
          status: 'queued' as const,
          input: { content: item.text, additionalPrompt: input.additionalPrompt },
          scene,
          parameters,
          model,
          imageModel: null,
          promptVersion: `algorithm:interest_assessment:v${interestAlgorithm.configurationVersion}`,
          contextProvider: contextSearch.provider,
          promptContextSnapshot,
          algorithmSnapshot: null,
          interestAlgorithmSnapshot: interestAlgorithm,
          evidence: runEvidence,
          timestamp,
        },
      }
    })
    await this.dependencies.runs.createInterestBatch({ batchId, personaId: input.personaId, taskId, items: runs, timestamp })
    return {
      batchId,
      personaId: input.personaId,
      personaName: persona.name,
      additionalPrompt: input.additionalPrompt,
      status: 'queued',
      items: runs.map(item => ({
        itemId: item.itemId,
        runId: item.run.runId,
        text: item.run.input.content,
        status: 'queued',
        decision: null,
        probability: null,
        confidence: null,
        reason: null,
        error: null,
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  /** @param kind 运行类型。 @param personaId 人物 UUID。 @param input 固定输入。 @param scene 仅兴趣判断可用的临时场景。 @returns 已创建运行。 */
  private async createRun(kind: GenerationRunRecord['kind'], personaId: string, input: GenerationRunRecord['input'], scene: GenerationRunRecord['scene']): Promise<CreatedRun> {
    const algorithmSnapshot = kind === 'artifact_generation' && this.dependencies.algorithms
      ? await this.prepareGenerationAlgorithms('imageCount' in input ? input.imageCount : 0)
      : null
    const articleStep = algorithmSnapshot?.articleGeneration.steps.find(step => step.stepKey === 'generate')
    const imageStep = algorithmSnapshot?.articleImageGeneration?.steps.find(step => step.stepKey === 'generate')
    const model = articleStep
      ? { provider: 'openai_compatible' as const, model: articleStep.model, endpointOrigin: new URL(articleStep.endpoint).origin }
      : this.dependencies.model.getConfiguredModel()
    if (!model) throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置', 422)
    const imageModel = 'imageCount' in input && input.imageCount > 0
      ? imageStep
        ? { provider: 'openai_compatible_images' as const, model: imageStep.model, endpointOrigin: new URL(imageStep.endpoint).origin }
        : this.dependencies.imageModel.getConfiguredModel()
      : null
    if ('imageCount' in input && input.imageCount > 0 && !imageModel) {
      throw new ApplicationError('CAPABILITY_DISABLED', '图片生成算法尚未配置，不能创建包含图片的运行', 422)
    }
    const promptCodes = kind === 'interest_assessment'
      ? [GENERATION_PROMPT_CODES.interestAssessment, GENERATION_PROMPT_CODES.jsonRetry]
      : [
          GENERATION_PROMPT_CODES.article,
          ...('imageCount' in input && input.imageCount > 0 ? [GENERATION_PROMPT_CODES.articleImages] : []),
          GENERATION_PROMPT_CODES.textBlock,
          GENERATION_PROMPT_CODES.jsonRetry,
          ...('imageCount' in input && input.imageCount > 0 ? [GENERATION_PROMPT_CODES.imageBlock] : []),
        ]
    const aiPromptVersions = await this.dependencies.prompts.snapshotPublishedVersions(promptCodes)
    const persona = await this.requirePersona(personaId)
    if (!persona.isEnabled) throw new ApplicationError('RESOURCE_DISABLED', '人物已禁用，不能创建新任务', 409)
    if (!persona.activeVersionId) throw new ApplicationError('PERSONA_VERSION_NOT_ACTIVE', '人物当前灵魂版本缺失，请重新保存灵魂提示词', 409)
    const version = await this.requirePublishedPersonaVersion(persona.activeVersionId, persona.id)
    const parameters = articleStep
      ? textModelParametersSchema.parse({
          ...DEFAULT_TEXT_PARAMETERS,
          ...articleStep.parameters,
        })
      : { ...DEFAULT_TEXT_PARAMETERS }
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
    const fixedPrompt = await this.buildInitialRunPrompt(
      kind,
      input,
      emptyPromptContext,
      aiPromptVersions,
    )
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
    const initialPrompt = await this.buildInitialRunPrompt(
      kind,
      input,
      promptContext,
      aiPromptVersions,
    )
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
      aiPromptVersions,
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
      personaVersionId: version.id, formatTemplateId: null, parameterProfileId: null,
      status: kind === 'interest_assessment' ? 'queued' : 'planning', input, scene, parameters, model, imageModel,
      promptVersion: `ai-catalog:${this.dependencies.sourceProcessor.hash(JSON.stringify(aiPromptVersions)).slice(0, 16)}`,
      contextProvider: contextSearch.provider,
      promptContextSnapshot,
      algorithmSnapshot,
      interestAlgorithmSnapshot: null,
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
   * 固定新图文运行使用的文章生成、正文修正和可选图片算法。
   * @param imageCount 用户明确要求的图片数量。
   * @returns 不含访问密钥的完整算法配置快照。
   */
  private async prepareGenerationAlgorithms(imageCount: number): Promise<GenerationAlgorithmSnapshot> {
    if (!this.dependencies.algorithms) throw new Error('图文算法服务未配置')
    const [articleGeneration, articleImageAnalysis, articleTextRevision, articleImageGeneration] = await Promise.all([
      this.dependencies.algorithms.prepare('article_generation'),
      imageCount > 0 ? this.dependencies.algorithms.prepare('article_image_analysis') : Promise.resolve(null),
      this.dependencies.algorithms.prepare('article_text_revision'),
      imageCount > 0 ? this.dependencies.algorithms.prepare('article_image_generation') : Promise.resolve(null),
    ])
    return { articleGeneration, articleImageAnalysis, articleTextRevision, articleImageGeneration }
  }

  /**
   * 构建创建运行时即可确定的首次文本模型提示。
   * @param kind 运行类型。
   * @param input 固定任务输入。
   * @param context 已选择的心智与资料上下文。
   * @param aiPromptVersions 创建运行时固定的提示词版本映射。
   * @returns 兴趣判断或完整文章生成的首次提示。
   */
  private buildInitialRunPrompt(
    kind: GenerationRunRecord['kind'],
    input: GenerationRunRecord['input'],
    context: PromptContext,
    aiPromptVersions: Record<string, string>,
  ): Promise<{ systemPrompt: string, userPrompt: string }> {
    if (kind === 'interest_assessment') {
      return this.dependencies.prompts.render(
        GENERATION_PROMPT_CODES.interestAssessment,
        buildInterestPromptVariables(context, 'content' in input ? input.content : ''),
        aiPromptVersions[GENERATION_PROMPT_CODES.interestAssessment],
      )
    }
    if (!('requirement' in input)) throw new Error('图文运行缺少创作条件')
    return this.dependencies.prompts.render(
      GENERATION_PROMPT_CODES.article,
      buildArticlePromptVariables(
        context,
        input.requirement,
        input.outputFormat,
      ),
      aiPromptVersions[GENERATION_PROMPT_CODES.article],
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
    const prompt = await this.dependencies.prompts.render(
      GENERATION_PROMPT_CODES.interestAssessment,
      buildInterestPromptVariables(context, 'content' in run.input ? run.input.content : ''),
      requireRunPromptVersion(run, GENERATION_PROMPT_CODES.interestAssessment),
    )
    const { output, usage } = await this.generateValidated(
      prompt,
      requireRunPromptVersion(run, GENERATION_PROMPT_CODES.jsonRetry),
      run.parameterSnapshot,
      'interest_assessment',
      (value) => {
      const parsed = interestAssessmentSchema.parse(value)
      const evidenceIds = new Set(context.evidence.map(item => item.id))
      if ([...parsed.supportingEvidenceIds, ...parsed.opposingEvidenceIds].some(id => !evidenceIds.has(id))) throw new Error('兴趣判断引用了不存在的证据标识')
      return parsed
      },
      run.usage,
    )
    if (await this.finishCancellationIfRequested(runId, usage)) return
    const cumulativeUsage = aggregateTextModelUsage(run.usage ? [run.usage, usage] : [usage])
    const timestamp = this.dependencies.clock.now()
    if (!await this.dependencies.runs.completeInterestRun(runId, output, cumulativeUsage, timestamp)) throw new Error('兴趣运行状态已经变化')
    await this.recordPersonaOperation(run, output.reasoningSummary, output as Record<string, unknown>, timestamp)
  }

  /**
   * 一次调用判定批次全部排队条目，逐项校验并隔离格式或证据错误。
   * @param batchId 兴趣批次 UUID。
   * @param itemId 单项重试时的客户端编号；主调用为空。
   * @returns 本轮全部目标条目写入终态时结束。
   */
  private async executeInterestBatch(batchId: string, itemId: string | null): Promise<void> {
    const batch = await this.dependencies.runs.findInterestBatch(batchId)
    if (!batch) throw new ApplicationError('RESOURCE_NOT_FOUND', '兴趣批次不存在', 404)
    const targets = batch.items.filter(item => itemId === null || item.itemId === itemId)
    if (targets.length !== 1 && itemId !== null) throw new ApplicationError('RESOURCE_NOT_FOUND', '兴趣批次条目不存在', 404)
    if (targets.length === 0) throw new ApplicationError('RESOURCE_NOT_FOUND', '兴趣批次没有可执行条目', 404)
    const started = await this.dependencies.runs.startInterestBatch(batchId, itemId, this.dependencies.clock.now())
    if (started !== targets.length) throw new Error('兴趣批次状态不允许执行当前任务')
    const firstTarget = targets[0]
    if (!firstTarget) throw new ApplicationError('RESOURCE_NOT_FOUND', '兴趣批次没有可执行条目', 404)
    const anchor = firstTarget.run
    const snapshot = anchor.interestAlgorithmSnapshot
    if (!snapshot) throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '兴趣运行缺少算法快照', 409)
    const loadedContext = await this.loadPromptContext(anchor)
    const context: PromptContext = {
      ...loadedContext,
      scene: 'content' in anchor.input && anchor.input.additionalPrompt
        ? anchor.input.additionalPrompt
        : loadedContext.scene,
    }
    const inputItems = targets.map(item => ({ itemId: item.itemId, text: 'content' in item.run.input ? item.run.input.content : '' }))
    const generated = await this.executeConfiguredGenerationStep(
      snapshot,
      'assess',
      buildInterestBatchPromptVariables(context, inputItems),
      'interest_batch_assessment',
      value => interestBatchModelOutputSchema.parse(value),
      anchor.parameterSnapshot,
      batch.usage,
      anchor.personaVersionId,
    )
    if (await this.finishCancellationIfRequested(anchor.id, generated.usage)) return
    const rawById = new Map<string, unknown>()
    const duplicateIds = new Set<string>()
    for (const value of generated.output.results) {
      if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>).itemId !== 'string') continue
      const responseItemId = String((value as Record<string, unknown>).itemId)
      if (rawById.has(responseItemId)) duplicateIds.add(responseItemId)
      else rawById.set(responseItemId, value)
    }
    const completed = await Promise.all(targets.map(async (target) => {
      const raw = rawById.get(target.itemId)
      if (raw === undefined) return invalidInterestBatchItem(target.run.id, '模型未返回该条目的判定结果')
      if (duplicateIds.has(target.itemId)) return invalidInterestBatchItem(target.run.id, '模型重复返回了该条目的判定结果')
      try {
        const parsed = interestBatchResultItemSchema.parse(raw)
        const targetEvidence = await this.dependencies.runs.listEvidence(target.run.id)
        const evidenceIdMap = new Map(targetEvidence.map(evidence => [
          typeof evidence.metadata.promptEvidenceId === 'string' ? evidence.metadata.promptEvidenceId : evidence.id,
          evidence.id,
        ]))
        const referencedIds = [...parsed.supportingEvidenceIds, ...parsed.opposingEvidenceIds]
        if (referencedIds.some(id => !evidenceIdMap.get(id))) throw new Error('兴趣判定引用了不存在的证据标识')
        const result = interestAssessmentSchema.parse({
          ...parsed,
          supportingEvidenceIds: parsed.supportingEvidenceIds.map(id => requireMappedEvidenceId(evidenceIdMap, id)),
          opposingEvidenceIds: parsed.opposingEvidenceIds.map(id => requireMappedEvidenceId(evidenceIdMap, id)),
        })
        return { runId: target.run.id, result, errorCode: null, errorMessage: null }
      }
      catch (error: unknown) {
        const reason = error instanceof Error ? error.message : '模型返回的条目格式无效'
        return invalidInterestBatchItem(target.run.id, reason)
      }
    }))
    const timestamp = this.dependencies.clock.now()
    await this.dependencies.runs.completeInterestBatch(batchId, completed, generated.usage, timestamp)
    for (const item of completed) {
      if (!item.result) continue
      const target = targets.find(value => value.run.id === item.runId)
      if (!target) throw new Error('兴趣批次完成项没有对应运行')
      await this.recordPersonaOperation(target.run, item.result.reasoningSummary, item.result as Record<string, unknown>, timestamp)
      await this.enqueueRunSessionIfTerminal(target.run.id)
    }
  }

  /** @param runId 图文创作运行 UUID。 @returns 最终文章、可选配图计划和自动确认文档保存完成时结束。 */
  private async executeDocumentPlan(runId: string): Promise<void> {
    const run = await this.requireRun(runId)
    if (!run.algorithmSnapshot) this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['planning', 'running'])
    const context = await this.loadPromptContext(run)
    if (!('requirement' in run.input)) throw new Error('图文运行缺少创作条件')
    const articleVariables = buildArticlePromptVariables(context, run.input.requirement, run.input.outputFormat)
    const articleResult = run.algorithmSnapshot
      ? await this.executeConfiguredGenerationStep(
          run.algorithmSnapshot.articleGeneration, 'generate', articleVariables, 'article',
          value => articleOutputSchema.parse(value), run.parameterSnapshot, run.usage, run.personaVersionId,
        )
      : await this.generateValidated(
          await this.dependencies.prompts.render(
            GENERATION_PROMPT_CODES.article,
            articleVariables,
            requireRunPromptVersion(run, GENERATION_PROMPT_CODES.article),
          ),
          requireRunPromptVersion(run, GENERATION_PROMPT_CODES.jsonRetry),
          run.parameterSnapshot,
          'article',
          value => articleOutputSchema.parse(value),
          run.usage,
        )
    if (articleResult.output.paragraphs.length > run.parameterSnapshot.maxTextBlocks) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '文章段落数量超过运行上限', 422)
    }
    if (await this.finishCancellationIfRequested(runId, articleResult.usage)) return

    let imagePlan: ArticleImagesOutput = { images: [] }
    let operationUsage = articleResult.usage
    if (run.input.imageCount > 0) {
      if (!run.algorithmSnapshot?.articleImageGeneration) this.requireMatchingImageModel(run)
      const imageVariables = buildArticleImagesPromptVariables(articleResult.output, run.input.imageCount)
      const priorUsage = aggregateTextModelUsage(run.usage ? [run.usage, articleResult.usage] : [articleResult.usage])
      const imageResult = run.algorithmSnapshot?.articleImageAnalysis
        ? await this.executeConfiguredGenerationStep(
            run.algorithmSnapshot.articleImageAnalysis, 'analyze', imageVariables, 'article_images',
            value => validateArticleImages(value, run.input.imageCount, articleResult.output.paragraphs.length),
            run.parameterSnapshot, priorUsage, run.personaVersionId,
          )
        : await this.generateValidated(
            await this.dependencies.prompts.render(
              GENERATION_PROMPT_CODES.articleImages,
              imageVariables,
              requireRunPromptVersion(run, GENERATION_PROMPT_CODES.articleImages),
            ),
            requireRunPromptVersion(run, GENERATION_PROMPT_CODES.jsonRetry),
            run.parameterSnapshot,
            'article_images',
            value => validateArticleImages(value, run.input.imageCount, articleResult.output.paragraphs.length),
            priorUsage,
          )
      operationUsage = aggregateTextModelUsage([operationUsage, imageResult.usage])
      imagePlan = imageResult.output
      if (await this.finishCancellationIfRequested(runId, operationUsage)) return
    }

    const spec = buildDirectDocumentSpec(articleResult.output, imagePlan, run.input.outputFormat)
    this.validateDocumentLimits(spec, run)
    const cumulativeUsage = aggregateTextModelUsage(run.usage ? [run.usage, operationUsage] : [operationUsage])
    if (!await this.dependencies.runs.savePlannedDocumentSpec(
      runId,
      this.dependencies.identifiers.create(),
      spec,
      cumulativeUsage,
      this.dependencies.clock.now(),
    )) throw new Error('文章保存时运行状态已经变化')
    const confirmed = await this.dependencies.runs.confirmDocumentSpec(
      runId,
      this.dependencies.identifiers.create(),
      this.dependencies.identifiers.create(),
      spec.blocks.map(() => this.dependencies.identifiers.create()),
      this.dependencies.clock.now(),
    )
    if (!confirmed) throw new Error('文章自动确认时运行状态已经变化')
  }

  /**
   * 使用运行创建时固定的算法快照执行兴趣或文章单步骤，并保留结构错误用量。
   * @param snapshot 固定算法实现、模型、提示词和参数。
   * @param stepKey 代码定义的唯一步骤键。
   * @param variables 已由代码组装的完整提示词变量。
   * @param schemaName 供应商诊断使用的结构名称。
   * @param parse 与生产业务一致的输出校验器。
   * @param limits 本次运行固定的总 Token 安全上限。
   * @param priorUsage 当前运行此前已持久化或本轮已产生的用量。
   * @param personaSnapshotHash 当前运行固定的人物版本标识。
   * @returns 已校验业务输出和本步骤新增用量。
   */
  private async executeConfiguredGenerationStep<T>(
    snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    schemaName: string,
    parse: (value: unknown) => T,
    limits: TextModelParameters,
    priorUsage: TextModelUsage | null,
    personaSnapshotHash: string,
  ): Promise<{ output: T, usage: TextModelUsage }> {
    if (!this.dependencies.algorithms) throw new ApplicationError('AI_ALGORITHM_NOT_CONFIGURED', 'AI 算法服务未配置', 422)
    const response = await this.dependencies.algorithms.executeStep(
      snapshot,
      stepKey,
      variables,
      schemaName,
      'json_object',
      { subjectSnapshotHash: personaSnapshotHash },
    )
    const cumulativeUsage = aggregateTextModelUsage(priorUsage ? [priorUsage, response.usage] : [response.usage])
    const totalTokens = usageTotalTokens(cumulativeUsage)
    if (totalTokens !== null && totalTokens > limits.maxTotalTokens) throw new TextUsageLimitError(response.usage)
    try {
      return { output: parse(response.structuredOutput), usage: response.usage }
    }
    catch (error: unknown) {
      const normalized = normalizeExecutionError(error)
      throw new TextResponseUsageError(normalized.code, normalized.message, normalized.retryable, response.usage)
    }
  }

  /** @param runId 已确认文档运行 UUID。 @returns 所有图文块串行执行结束时完成。 */
  private async executeDocument(runId: string): Promise<void> {
    const run = await this.requireRun(runId)
    if (!run.algorithmSnapshot?.articleTextRevision) this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['queued', 'running'])
    const context = await this.loadPromptContext(run)
    const spec = (await this.dependencies.runs.listDocumentSpecs(runId)).find(item => item.status === 'confirmed')
    if (!spec) throw new ApplicationError('DOCUMENT_SPEC_NOT_CONFIRMED', '文档规格尚未确认', 409)
    if (spec.spec.blocks.some(block => block.type === 'image') && !run.algorithmSnapshot?.articleImageGeneration) {
      this.requireMatchingImageModel(run)
    }
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
    if (status !== 'failed') {
      const textCount = blocks.filter(block => block.type === 'text' && block.status === 'succeeded').length
      const imageCount = blocks.filter(block => block.type === 'image' && block.status === 'succeeded').length
      await this.recordPersonaOperation(
        run,
        `图文任务已${status === 'succeeded' ? '全部完成' : '部分完成'}，已保留 ${textCount} 段正文和 ${imageCount} 张图片。`,
        null,
        timestamp,
      )
    }
  }

  /**
   * 执行一次普通单块重试或用户反馈指导的修正重试。
   * @param runId 运行 UUID。
   * @param blockId 目标块 UUID。
   * @param correctionInstruction 用户确认用于修正当前块的反馈正文；普通手工重试为空。
   * @returns 单块任务完成时结束。
   */
  private async executeSingleBlock(runId: string, blockId: string, correctionInstruction: string | null): Promise<void> {
    const run = await this.requireRun(runId)
    if (!run.algorithmSnapshot?.articleTextRevision) this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['queued', 'running'])
    const context = await this.loadPromptContext(run)
    const spec = (await this.dependencies.runs.listDocumentSpecs(runId)).find(item => item.status === 'confirmed')
    if (!spec) throw new ApplicationError('DOCUMENT_SPEC_NOT_CONFIRMED', '文档规格尚未确认', 409)
    await this.dependencies.runs.recoverInterruptedDocumentBlocks(runId, this.dependencies.clock.now())
    const blocks = await this.dependencies.runs.listBlocks(runId)
    const target = blocks.find(block => block.id === blockId)
    if (!target) throw new ApplicationError('RESOURCE_NOT_FOUND', '产物块不存在', 404)
    if (target.isLocked) throw new ApplicationError('BLOCK_LOCKED', '锁定块不能重试', 409)
    if (target.type === 'image' && !run.algorithmSnapshot?.articleImageGeneration) this.requireMatchingImageModel(run)
    const previousOutputs: Array<{ key: string, text: string }> = []
    for (const block of blocks.slice(0, target.ordinal)) {
      if (block.status === 'succeeded') await this.appendSelectedText(block, previousOutputs)
    }
    if (!dependenciesSucceeded(target, blocks)) await this.recordDependencyFailure(run, target, previousOutputs)
    else await this.executeArtifactBlock(run, context, spec.spec, target, previousOutputs, correctionInstruction)
    const timestamp = this.dependencies.clock.now()
    const status = await this.dependencies.runs.finishDocumentRun(runId, timestamp)
    if (status !== 'failed') await this.recordPersonaOperation(run, `图文任务根据反馈修正后状态为${status === 'succeeded' ? '全部完成' : '部分完成'}。`, null, timestamp)
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
   * @param correctionInstruction 用户反馈指导的本次修正要求；普通执行为空。
   * @returns 是否成功及可供后续块使用的文字。
   */
  private async executeArtifactBlock(
    run: GenerationRunRecord,
    context: PromptContext,
    documentSpec: DocumentSpec,
    block: ArtifactBlockRecord,
    previousOutputs: Array<{ key: string, text: string }>,
    correctionInstruction: string | null = null,
  ): Promise<{ succeeded: boolean, text: string | null }> {
    const existingAttempts = await this.dependencies.runs.listBlockAttempts(block.id)
    if (block.spec.type === 'text' && block.spec.generatedText && correctionInstruction === null) {
      if (existingAttempts.length >= run.parameterSnapshot.maxBlockAttempts) return { succeeded: false, text: null }
      const attemptId = this.dependencies.identifiers.create()
      const attempt = await this.dependencies.runs.startBlockAttempt(block.id, attemptId, {
        promptVersion: run.promptVersion,
        generatedArticleText: true,
      }, this.dependencies.clock.now())
      if (!attempt) return { succeeded: false, text: null }
      // 完整文章已由前一模型调用生成；这里只把段落落入既有文档存储，不产生新的供应商用量。
      await this.dependencies.runs.completeBlockAttempt(
        block.id,
        attemptId,
        block.spec.generatedText,
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        this.dependencies.clock.now(),
      )
      return { succeeded: true, text: block.spec.generatedText }
    }
    // 用户明确确认的反馈必须获得一次新的修正机会，不受该块此前自动尝试次数影响。
    const remainingAttempts = correctionInstruction === null
      ? run.parameterSnapshot.maxBlockAttempts - existingAttempts.length
      : 1
    for (let attemptIndex = 0; attemptIndex < remainingAttempts; attemptIndex += 1) {
      const attemptId = this.dependencies.identifiers.create()
      const inputSnapshot = block.spec.type === 'image'
        ? { promptVersion: run.promptVersion, block: block.spec, visualBrief: block.spec.visualBrief, previousOutputs, ...(correctionInstruction === null ? {} : { correctionInstruction }) }
        : { promptVersion: run.promptVersion, block: block.spec, previousOutputs, ...(correctionInstruction === null ? {} : { correctionInstruction }) }
      const attempt = await this.dependencies.runs.startBlockAttempt(block.id, attemptId, inputSnapshot, this.dependencies.clock.now())
      if (!attempt) break
      let responseUsage: TextModelUsage | null = null
      try {
        if (block.spec.type === 'image') {
          const brief = correctionInstruction === null
            ? block.spec.visualBrief
            : { ...block.spec.visualBrief, theme: appendCorrectionInstruction(block.spec.visualBrief.theme, correctionInstruction) }
          const variables = buildImagePromptVariables(context, brief, previousOutputs)
          const response = run.algorithmSnapshot?.articleImageGeneration && this.dependencies.algorithms
            ? await this.dependencies.algorithms.executeImageStep(
                run.algorithmSnapshot.articleImageGeneration,
                'generate',
                variables,
                brief.aspectRatio,
              )
            : await this.generateLegacyImageBlock(run, variables, brief.aspectRatio)
          const assetId = this.dependencies.identifiers.create()
          const stored = await this.dependencies.imageAssets.saveImage(run.id, assetId, response.bytes, response.declaredMediaType)
          let originalStored: Awaited<ReturnType<ImageAssetStorage['saveImage']>> | null = null
          try {
            if (response.original) {
              originalStored = await this.dependencies.imageAssets.saveImage(
                run.id,
                this.dependencies.identifiers.create(),
                response.original.bytes,
                response.original.declaredMediaType,
              )
            }
            await this.dependencies.runs.completeImageBlockAttempt(block.id, attemptId, {
              id: assetId,
              ...stored,
              altText: brief.altText,
              original: originalStored,
            }, this.dependencies.clock.now())
          }
          catch (error: unknown) {
            // 原图保存或数据库事务失败时同时删除两份文件，避免产生无法从业务事实定位的孤儿资产。
            await Promise.all([
              this.dependencies.imageAssets.deleteImage(run.id, stored.relativePath),
              ...(originalStored ? [this.dependencies.imageAssets.deleteImage(run.id, originalStored.relativePath)] : []),
            ])
            throw error
          }
          return { succeeded: true, text: null }
        }
        const correctedBlock = correctionInstruction === null
          ? block.spec
          : { ...block.spec, instruction: appendCorrectionInstruction(block.spec.instruction, correctionInstruction) }
        const variables = buildTextBlockPromptVariables(context, documentSpec, correctedBlock, previousOutputs)
        await this.assertRunTokenBudget(run, null)
        const response = run.algorithmSnapshot?.articleTextRevision && this.dependencies.algorithms
          ? await this.dependencies.algorithms.executeStep(
              run.algorithmSnapshot.articleTextRevision,
              'revise',
              variables,
              'text_block',
              'json_object',
              { subjectSnapshotHash: run.personaVersionId },
            )
          : await this.generateLegacyTextBlock(run, variables)
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

  /**
   * 使用迁移前运行固定的提示词和默认图片模型生成图片块。
   * @param run 不含图片生成算法快照的历史运行。
   * @param variables 已由业务代码组装的图片提示词变量。
   * @param aspectRatio 历史运行文档规格固定的宽高比。
   * @returns 尚未写入本地资产目录的图片响应。
   */
  private async generateLegacyImageBlock(
    run: GenerationRunRecord,
    variables: Record<string, string>,
    aspectRatio: '1:1' | '4:3' | '3:4' | '16:9' | '9:16',
  ) {
    const prompt = await this.dependencies.prompts.render(
      GENERATION_PROMPT_CODES.imageBlock,
      variables,
      requireRunPromptVersion(run, GENERATION_PROMPT_CODES.imageBlock),
    )
    this.assertPromptCharacterLimit(prompt, run.parameterSnapshot)
    return await this.dependencies.imageModel.generate({
      prompt: prompt.userPrompt,
      aspectRatio,
      timeoutMs: run.parameterSnapshot.timeoutMs,
    })
  }

  /**
   * 使用迁移前运行固定的提示词和默认文本模型生成修正段落。
   * @param run 不含正文修正算法快照的历史运行。
   * @param variables 已由业务代码组装的正文修正提示词变量。
   * @returns 供应商结构化文本响应及用量。
   */
  private async generateLegacyTextBlock(run: GenerationRunRecord, variables: Record<string, string>) {
    const prompt = await this.dependencies.prompts.render(
      GENERATION_PROMPT_CODES.textBlock,
      variables,
      requireRunPromptVersion(run, GENERATION_PROMPT_CODES.textBlock),
    )
    this.assertPromptCharacterLimit(prompt, run.parameterSnapshot)
    this.assertPromptInputBudget(prompt, run.parameterSnapshot, run.modelSnapshot.model)
    return await this.dependencies.model.generateStructured({
      ...prompt,
      parameters: run.parameterSnapshot,
      responseSchemaName: 'text_block',
    })
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
   * @param retryPromptVersionId 本次操作锁定的结构校验重试提示词版本。
   * @param parameters 固定参数。
   * @param schemaName 结构名称。
   * @param parse 结构校验器。
   * @param priorUsage 当前运行此前已保存的用量；非运行调用为空。
   * @returns 校验通过的结构和本轮新增用量。
   */
  private async generateValidated<T>(
    prompt: { systemPrompt: string, userPrompt: string },
    retryPromptVersionId: string,
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
        currentPrompt = await this.dependencies.prompts.render(
          GENERATION_PROMPT_CODES.jsonRetry,
          {
            originalSystemPrompt: prompt.systemPrompt,
            originalUserPrompt: prompt.userPrompt,
            errorMessageJson: JSON.stringify(normalized.message),
          },
          retryPromptVersionId,
        )
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
      if (!('imageCount' in run.input) || run.input.imageCount === 0 || !run.imageModelSnapshot) {
        throw new ApplicationError('CAPABILITY_DISABLED', '当前运行没有启用图片能力，不能加入图片块', 422)
      }
      if (!run.algorithmSnapshot?.articleImageGeneration) this.requireMatchingImageModel(run)
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
        promptEvidenceId: evidenceId,
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

/**
 * 从任务载荷读取一个可选字符串字段。
 * @param payloadJson 任务载荷 JSON。
 * @param field 目标字段名称。
 * @returns 非空字符串字段；缺失时返回 null。
 */
function readOptionalPayloadString(payloadJson: string, field: string): string | null {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  return typeof value[field] === 'string' && value[field].trim() ? value[field] : null
}

/**
 * 把兴趣运行内部状态收敛为批次公开的四态条目状态。
 * @param status 当前运行状态。
 * @returns 批次条目状态；取消及其他终态统一视为失败。
 */
function normalizeInterestItemStatus(status: GenerationRunRecord['status']): InterestBatchView['items'][number]['status'] {
  if (status === 'queued') return 'queued'
  if (status === 'running') return 'running'
  if (status === 'succeeded') return 'succeeded'
  return 'failed'
}

/**
 * 构造一个不会影响其他条目的模型输出失败结果。
 * @param runId 目标独立运行 UUID。
 * @param message 可审计但不包含敏感输入的失败原因。
 * @returns 批次仓储可直接写入的失败项。
 */
function invalidInterestBatchItem(runId: string, message: string) {
  return { runId, result: null, errorCode: 'MODEL_OUTPUT_INVALID', errorMessage: message.slice(0, 500) }
}

/**
 * 读取已经验证存在的证据标识映射。
 * @param mapping 主调用证据 UUID 到目标运行证据 UUID 的映射。
 * @param sourceId 模型返回的主调用证据 UUID。
 * @returns 目标运行对应证据 UUID。
 */
function requireMappedEvidenceId(mapping: Map<string, string | undefined>, sourceId: string): string {
  const targetId = mapping.get(sourceId)
  if (!targetId) throw new Error('兴趣判定引用了不存在的证据标识')
  return targetId
}

/** @param payloadJson 任务载荷 JSON。 @returns 单块任务 UUID。 */
function readBlockId(payloadJson: string): string {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  if (typeof value.blockId !== 'string') throw new Error('任务载荷缺少块标识')
  return value.blockId
}

/**
 * 从单块任务载荷读取用户确认的当前产物修正要求。
 * @param payloadJson 任务载荷 JSON。
 * @returns 反馈触发重试时返回反馈正文，普通重试返回 null。
 */
function readCorrectionInstruction(payloadJson: string): string | null {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  return typeof value.correctionInstruction === 'string' && value.correctionInstruction.trim()
    ? value.correctionInstruction.trim()
    : null
}

/**
 * 在原块要求后追加由管理员确认的反馈，不改变已确认文档规格。
 * @param originalInstruction 已确认的原块要求或视觉主题。
 * @param correctionInstruction 用户反馈正文。
 * @returns 仅用于本次重试的完整要求。
 */
function appendCorrectionInstruction(originalInstruction: string, correctionInstruction: string): string {
  return `${originalInstruction}\n\n本次重试必须根据以下用户反馈修正：${correctionInstruction}`
}

/** @param block 目标块。 @param blocks 同文档块快照。 @returns 全部显式依赖是否成功。 */
function dependenciesSucceeded(block: ArtifactBlockRecord, blocks: ArtifactBlockRecord[]): boolean {
  return block.spec.dependsOn.every(key => blocks.find(candidate => candidate.specKey === key)?.status === 'succeeded')
}

/**
 * 校验文章配图数量与插入位置，并按正文阅读顺序稳定排序。
 * @param value 模型返回的未知配图结构。
 * @param imageCount 用户明确要求的图片数量。
 * @param paragraphCount 已生成文章的段落数量。
 * @returns 数量准确、位置有效的配图计划。
 */
function validateArticleImages(value: unknown, imageCount: number, paragraphCount: number): ArticleImagesOutput {
  const parsed = articleImagesOutputSchema.parse(value)
  if (parsed.images.length !== imageCount) {
    throw new ZodError([{ code: 'custom', path: ['images'], message: `配图数量必须严格等于 ${imageCount}`, input: value }])
  }
  if (parsed.images.some(image => image.afterParagraph >= paragraphCount)) {
    throw new ZodError([{ code: 'custom', path: ['images'], message: '配图插入位置超出文章段落范围', input: value }])
  }
  return {
    images: parsed.images
      .map((image, index) => ({ image, index }))
      .sort((left, right) => left.image.afterParagraph - right.image.afterParagraph || left.index - right.index)
      .map(item => item.image),
  }
}

/**
 * 把最终文章和后置配图计划转换为内部持久文档；技术块只用于保存顺序，不暴露给用户编辑。
 * @param article 已完成的最终文章。
 * @param imagePlan 已校验并按正文顺序排列的配图计划。
 * @param outputFormat 用户要求的 HTML 或纯文本格式。
 * @returns 可由既有安全渲染器和图片执行器消费的内部文档规格。
 */
function buildDirectDocumentSpec(
  article: ArticleOutput,
  imagePlan: ArticleImagesOutput,
  outputFormat: ArtifactOutputFormat,
): DocumentSpec {
  const blocks: DocumentSpec['blocks'] = []
  let imageOrdinal = 0
  article.paragraphs.forEach((paragraph, paragraphIndex) => {
    blocks.push({
      key: `paragraph_${paragraphIndex + 1}`,
      type: 'text',
      role: 'paragraph',
      instruction: `使用已经生成的文章第 ${paragraphIndex + 1} 段`,
      acceptanceCriteria: ['保持已生成正文原样'],
      dependsOn: [],
      generatedText: paragraph,
    })
    for (const image of imagePlan.images.filter(item => item.afterParagraph === paragraphIndex)) {
      imageOrdinal += 1
      blocks.push({
        key: `image_${imageOrdinal}`,
        type: 'image',
        role: 'illustration',
        instruction: `根据最终文章生成第 ${imageOrdinal} 张相关配图`,
        acceptanceCriteria: ['图片与文章内容直接相关'],
        dependsOn: [],
        visualBrief: image.visualBrief,
      })
    }
  })
  return {
    title: article.title,
    summary: article.summary,
    purpose: '',
    constraints: [],
    requestedFormats: [outputFormat === 'html' ? 'html' : 'txt'],
    blocks,
  }
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

/**
 * 读取新运行固定的提示词版本；迁移前旧运行不允许继续调用已移除的硬编码提示词。
 * @param run 当前运行记录。
 * @param code 本次模型调用需要的提示词编码。
 * @returns 创建运行时固定的不可变版本 UUID。
 */
function requireRunPromptVersion(run: GenerationRunRecord, code: string): string {
  const versionId = run.promptContextSnapshot?.aiPromptVersions?.[code]
  if (!versionId) {
    throw new ApplicationError('AI_PROMPT_VERSION_MISSING', '该历史任务没有提示词版本快照，不能继续执行或重试', 409)
  }
  return versionId
}

/** @param role 资料业务角色。 @returns 数值越小表示人物草稿提示中的事实优先级越高。 */
function sourceRoleRank(role: 'canon_fact' | 'reference' | 'style_sample'): number {
  if (role === 'canon_fact') return 0
  if (role === 'reference') return 1
  return 2
}

/** @param usages 一次或多次供应商响应的用量。 @returns 各字段严格合计，任一响应缺字段时该合计为 null。 */
function aggregateTextModelUsage(usages: TextModelUsage[]): TextModelUsage {
  const cachedValues = usages.map(usage => usage.cachedInputTokens)
  return {
    inputTokens: sumUsageField(usages.map(usage => usage.inputTokens)),
    outputTokens: sumUsageField(usages.map(usage => usage.outputTokens)),
    totalTokens: sumUsageField(usages.map(usage => usage.totalTokens)),
    ...(cachedValues.some(value => value !== undefined)
      ? { cachedInputTokens: sumUsageField(cachedValues.map(value => value ?? null)) }
      : {}),
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
