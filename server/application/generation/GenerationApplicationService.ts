import { ZodError } from 'zod'
import { worldSnapshotSchema } from '../../../shared/schemas/content'
import {
  documentSpecSchema,
  interestAssessmentSchema,
  textBlockOutputSchema,
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
  RunDetails,
  RunSummary,
} from '../../../shared/types/generation'
import type { PersonaRecord, PersonaVersionRecord } from '../../domain/content/ContentModels'
import type { GenerationRunRecord, TextModelUsage } from '../../domain/generation/GenerationModels'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { ContextProvider } from '../../ports/ContextProvider'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { RunListFilter, RunRepository } from '../../ports/RunRepository'
import type { SourceContentProcessor } from '../../ports/SourceContentPorts'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import type { TextModelPort } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import { ApplicationError } from '../errors/ApplicationError'
import {
  buildDocumentPlanPrompt,
  buildInterestPrompt,
  buildTextBlockPrompt,
  GENERATION_PROMPT_VERSION,
  type PromptContext,
} from './PromptBuilder'

/** 未选择参数方案时使用并保存到运行快照的默认参数。 */
export const DEFAULT_TEXT_PARAMETERS: TextModelParameters = {
  temperature: 0.4,
  maxOutputTokens: 2_048,
  timeoutMs: 60_000,
  maxEvidenceChunks: 8,
  maxTextBlocks: 12,
}

/** 未选择格式模板时使用的最小纯文字模板。 */
const DEFAULT_FORMAT_TEMPLATE = {
  guidance: '按用户要求组织清晰的纯文字内容；标题、正文和列表按需要使用。',
  minimumBlocks: 1,
  maximumBlocks: 8,
}

/** 生成应用服务依赖。 */
export interface GenerationApplicationServiceDependencies {
  runs: RunRepository
  content: ContentRepository
  context: ContextProvider
  model: TextModelPort
  identifiers: IdentifierGenerator
  clock: Clock
  sourceProcessor: SourceContentProcessor
}

/** 编排运行创建、查询、规格确认和 Worker 模型执行。 */
export class GenerationApplicationService implements TaskHandler {
  /** @param dependencies 运行、内容、检索、模型、标识、时间和哈希端口。 */
  constructor(private readonly dependencies: GenerationApplicationServiceDependencies) {}

  /** @returns 文本模型非敏感能力状态。 */
  getTextModelCapability() {
    const configured = this.dependencies.model.getConfiguredModel()
    return configured
      ? { configured: true, ...configured }
      : { configured: false, provider: 'openai_compatible' as const, model: null, endpointOrigin: null }
  }

  /** @returns 当前阶段全部非敏感外部能力和实际上下文提供器。 */
  getCapabilities() {
    return {
      textModel: this.getTextModelCapability(),
      imageModel: { configured: false },
      openViking: { configured: false, enabled: false },
      contextProvider: 'sqlite_fts5' as const,
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
    return await this.createRun('artifact_generation', input.personaId, { requirement: input.requirement }, input.scene ?? null, input.parameterProfileId ?? null, input.formatTemplateId ?? null)
  }

  /** @param filter 已校验运行过滤条件。 @returns 运行摘要列表。 */
  async listRuns(filter: RunListFilter): Promise<RunSummary[]> {
    const runs = await this.dependencies.runs.listRuns(filter)
    return await Promise.all(runs.map(run => this.toRunSummary(run)))
  }

  /** @param runId 运行 UUID。 @returns 运行、证据、规格、块、尝试和任务。 */
  async getRun(runId: string): Promise<RunDetails> {
    const run = await this.requireRun(runId)
    const [evidence, documentSpecs, blocks, tasks] = await Promise.all([
      this.dependencies.runs.listEvidence(runId),
      this.dependencies.runs.listDocumentSpecs(runId),
      this.dependencies.runs.listBlocks(runId),
      this.dependencies.runs.listRunTasks(runId),
    ])
    return {
      run: await this.toRunSummary(run),
      evidence: evidence.map(({ runId: _, createdAt: __, ...item }) => item),
      documentSpecs: documentSpecs.map(({ runId: _, ...item }) => item),
      blocks: await Promise.all(blocks.map(async block => ({
        id: block.id, specKey: block.specKey, ordinal: block.ordinal, role: block.role,
        instruction: block.spec.instruction, acceptanceCriteria: block.spec.acceptanceCriteria,
        status: block.status, selectedAttemptId: block.selectedAttemptId, isLocked: block.isLocked,
        attempts: (await this.dependencies.runs.listBlockAttempts(block.id)).map(({ blockId: _, inputSnapshot: __, usage: ___, ...attempt }) => attempt),
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
    const taskId = this.dependencies.identifiers.create()
    const retried = await this.dependencies.runs.retryRun(runId, taskId, this.dependencies.clock.now())
    if (!retried) throw new ApplicationError('VERSION_CONFLICT', '运行状态已经变化，请刷新后重试', 409)
    return { runId, taskId, status: retried.status }
  }

  /** @param job Worker 已领取任务。 @returns 业务执行结束时完成。 */
  async execute(job: TaskJob): Promise<void> {
    const runId = readRunId(job.payloadJson)
    try {
      if (job.type === 'assess_interest') await this.executeInterest(runId)
      else if (job.type === 'plan_document') await this.executeDocumentPlan(runId)
      else if (job.type === 'execute_document') await this.executeDocument(runId)
      else throw new Error(`未注册任务类型：${job.type}`)
    }
    catch (error: unknown) {
      if (await this.finishCancellationIfRequested(runId)) return
      const normalized = normalizeExecutionError(error)
      const willRetry = normalized.retryable && job.attemptCount < job.maxAttempts
      if (willRetry) {
        await this.dependencies.runs.prepareAutomaticRetry(runId, job.type, this.dependencies.clock.now())
      }
      else {
        await this.dependencies.runs.failRun(runId, normalized.code, normalized.message, this.dependencies.clock.now())
      }
      throw new TaskExecutionError(`${normalized.code}：${normalized.message}`, normalized.retryable)
    }
  }

  /** @param kind 运行类型。 @param personaId 人物 UUID。 @param input 固定输入。 @param scene 场景。 @param profileId 参数方案。 @param templateId 格式模板。 @returns 已创建运行。 */
  private async createRun(kind: GenerationRunRecord['kind'], personaId: string, input: GenerationRunRecord['input'], scene: GenerationRunRecord['scene'], profileId: string | null, templateId: string | null): Promise<CreatedRun> {
    const model = this.dependencies.model.getConfiguredModel()
    if (!model) throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置', 422)
    const persona = await this.requirePersona(personaId)
    if (!persona.activeVersionId) throw new ApplicationError('PERSONA_VERSION_NOT_ACTIVE', '人物尚无已发布当前版本', 409)
    const version = await this.requirePublishedPersonaVersion(persona.activeVersionId, persona.id)
    const parameters = await this.resolveParameters(profileId)
    if (templateId) await this.requireFormatTemplate(templateId)
    const query = 'content' in input ? input.content : input.requirement
    const candidates = await this.dependencies.context.search({ personaId, worldId: persona.worldId, query, limit: parameters.maxEvidenceChunks })
    const runId = this.dependencies.identifiers.create()
    const taskId = this.dependencies.identifiers.create()
    const timestamp = this.dependencies.clock.now()
    const userSettingContent = JSON.stringify(version.snapshot)
    const userSettings = [
      {
        id: this.dependencies.identifiers.create(), sourceId: null, chunkId: null, role: 'user_setting' as const,
        content: userSettingContent, contentHash: this.dependencies.sourceProcessor.hash(userSettingContent),
        rank: 0, metadata: { personaVersionId: version.id },
      },
    ]
    if (persona.worldId) {
      const world = await this.dependencies.content.findWorld(persona.worldId)
      const worldVersion = world?.activeVersionId
        ? await this.dependencies.content.findWorldVersion(world.activeVersionId)
        : null
      if (worldVersion?.status === 'published') {
        const content = JSON.stringify(worldVersion.snapshot)
        userSettings.push({
          id: this.dependencies.identifiers.create(), sourceId: null, chunkId: null, role: 'user_setting',
          content, contentHash: this.dependencies.sourceProcessor.hash(content), rank: 1,
          metadata: { worldVersionId: worldVersion.id },
        })
      }
    }
    await this.dependencies.runs.createRun({
      runId, taskId, taskType: kind === 'interest_assessment' ? 'assess_interest' : 'plan_document', kind,
      personaVersionId: version.id, formatTemplateId: templateId, parameterProfileId: profileId,
      status: kind === 'interest_assessment' ? 'queued' : 'planning', input, scene, parameters, model,
      promptVersion: GENERATION_PROMPT_VERSION,
      evidence: [
        ...userSettings,
        ...candidates.map((candidate, index) => ({ id: this.dependencies.identifiers.create(), sourceId: candidate.sourceId, chunkId: candidate.chunkId, role: candidate.role, content: candidate.content, contentHash: candidate.contentHash, rank: index + userSettings.length, metadata: { heading: candidate.heading, priority: candidate.priority } })),
      ],
      timestamp,
    })
    return { runId, taskId, status: kind === 'interest_assessment' ? 'queued' : 'planning' }
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
    })
    if (await this.finishCancellationIfRequested(runId)) return
    if (!await this.dependencies.runs.completeInterestRun(runId, output, usage, this.dependencies.clock.now())) throw new Error('兴趣运行状态已经变化')
  }

  /** @param runId 文档规划运行 UUID。 @returns 规划结束时完成。 */
  private async executeDocumentPlan(runId: string): Promise<void> {
    const run = await this.requireRun(runId)
    this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['planning', 'running'])
    const context = await this.loadPromptContext(run)
    const template = run.formatTemplateId ? await this.requireFormatTemplate(run.formatTemplateId) : { spec: DEFAULT_FORMAT_TEMPLATE }
    const maximum = Math.min(template.spec.maximumBlocks, run.parameterSnapshot.maxTextBlocks)
    const prompt = buildDocumentPlanPrompt(context, 'requirement' in run.input ? run.input.requirement : '', template.spec.guidance, template.spec.minimumBlocks, maximum)
    const { output, usage } = await this.generateValidated(prompt, run.parameterSnapshot, 'document_spec', value => {
      const parsed = documentSpecSchema.parse(value)
      if (parsed.blocks.length < template.spec.minimumBlocks || parsed.blocks.length > maximum) throw new Error('模型规划的块数量超出模板或运行限制')
      return parsed
    })
    if (await this.finishCancellationIfRequested(runId)) return
    if (!await this.dependencies.runs.savePlannedDocumentSpec(runId, this.dependencies.identifiers.create(), output, usage, this.dependencies.clock.now())) throw new Error('文档规划运行状态已经变化')
  }

  /** @param runId 已确认文档运行 UUID。 @returns 所有文字块串行执行结束时完成。 */
  private async executeDocument(runId: string): Promise<void> {
    const run = await this.requireRun(runId)
    this.requireMatchingModel(run)
    await this.requireRunStarted(run, ['queued', 'running'])
    const context = await this.loadPromptContext(run)
    const spec = (await this.dependencies.runs.listDocumentSpecs(runId)).find(item => item.status === 'confirmed')
    if (!spec) throw new ApplicationError('DOCUMENT_SPEC_NOT_CONFIRMED', '文档规格尚未确认', 409)
    await this.dependencies.runs.recoverInterruptedDocumentBlocks(runId, this.dependencies.clock.now())
    const blocks = await this.dependencies.runs.listBlocks(runId)
    const previousOutputs: Array<{ key: string, text: string }> = []
    for (const block of blocks) {
      if (await this.dependencies.runs.isCancellationRequested(runId)) {
        await this.dependencies.runs.markRunCanceled(runId, this.dependencies.clock.now())
        return
      }
      if (block.status === 'succeeded' && block.selectedAttemptId) {
        const selected = (await this.dependencies.runs.listBlockAttempts(block.id))
          .find(attempt => attempt.id === block.selectedAttemptId)
        if (selected?.outputText) previousOutputs.push({ key: block.specKey, text: selected.outputText })
        continue
      }
      const prompt = buildTextBlockPrompt(context, spec.spec, block.spec, previousOutputs)
      let succeeded = false
      for (let attemptIndex = 0; attemptIndex < 2 && !succeeded; attemptIndex += 1) {
        const attemptId = this.dependencies.identifiers.create()
        const attempt = await this.dependencies.runs.startBlockAttempt(block.id, attemptId, { promptVersion: run.promptVersion, block: block.spec, previousOutputs }, this.dependencies.clock.now())
        if (!attempt) break
        try {
          const response = await this.dependencies.model.generateStructured({ ...prompt, parameters: run.parameterSnapshot, responseSchemaName: 'text_block' })
          const output = textBlockOutputSchema.parse(response.structuredOutput)
          await this.dependencies.runs.completeBlockAttempt(block.id, attemptId, output.text, response.usage, this.dependencies.clock.now())
          previousOutputs.push({ key: block.specKey, text: output.text })
          succeeded = true
        }
        catch (error: unknown) {
          const normalized = normalizeExecutionError(error)
          await this.dependencies.runs.failBlockAttempt(block.id, attemptId, normalized.code, normalized.message, this.dependencies.clock.now())
        }
      }
    }
    await this.dependencies.runs.finishDocumentRun(runId, this.dependencies.clock.now())
  }

  /** @param prompt 已分层提示。 @param parameters 固定参数。 @param schemaName 结构名称。 @param parse 结构校验器。 @returns 最多两次尝试后的结果。 */
  private async generateValidated<T>(prompt: { systemPrompt: string, userPrompt: string }, parameters: TextModelParameters, schemaName: string, parse: (value: unknown) => T): Promise<{ output: T, usage: TextModelUsage }> {
    let lastError: unknown
    let currentPrompt = prompt
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.dependencies.model.generateStructured({ ...currentPrompt, parameters, responseSchemaName: schemaName })
        return { output: parse(response.structuredOutput), usage: response.usage }
      }
      catch (error: unknown) {
        lastError = error
        const normalized = normalizeExecutionError(error)
        if (error instanceof TextModelError && !error.retryable) break
        currentPrompt = { ...prompt, userPrompt: `${prompt.userPrompt}\n\n<上次输出校验错误>${JSON.stringify(normalized.message)}</上次输出校验错误>\n请重新输出完整 JSON 对象。` }
      }
    }
    throw lastError
  }

  /** @param run 固定运行。 @returns 人物、世界、场景和证据提示上下文。 */
  private async loadPromptContext(run: GenerationRunRecord): Promise<PromptContext> {
    const version = await this.requirePublishedPersonaVersion(run.personaVersionId)
    const evidence = await this.dependencies.runs.listEvidence(run.id)
    const worldEvidence = evidence.find(item => typeof item.metadata.worldVersionId === 'string')
    const world = worldEvidence ? worldSnapshotSchema.parse(JSON.parse(worldEvidence.content)) : null
    return { persona: version.snapshot, world, scene: run.scene, evidence }
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

  /** @param runId 运行 UUID。 @returns 存在取消请求时完成取消并返回 true。 */
  private async finishCancellationIfRequested(runId: string): Promise<boolean> {
    if (!await this.dependencies.runs.isCancellationRequested(runId)) return false
    await this.dependencies.runs.markRunCanceled(runId, this.dependencies.clock.now())
    return true
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
    if (spec.blocks.length > run.parameterSnapshot.maxTextBlocks) throw new ApplicationError('TASK_LIMIT_EXCEEDED', '文档文字块数量超过运行上限', 422)
  }

  /** @param run 运行记录。 @returns 带人物身份的公开摘要。 */
  private async toRunSummary(run: GenerationRunRecord): Promise<RunSummary> {
    const identity = await this.dependencies.runs.findRunPersona(run.id)
    if (!identity) throw new Error('运行人物关系损坏')
    return { id: run.id, kind: run.kind, personaVersionId: run.personaVersionId, ...identity, status: run.status, input: run.input, scene: run.scene, parameters: run.parameterSnapshot, model: run.modelSnapshot, promptVersion: run.promptVersion, contextProvider: run.contextProvider, result: run.result, errorCode: run.errorCode, errorMessage: run.errorMessage, createdAt: run.createdAt, updatedAt: run.updatedAt, completedAt: run.completedAt }
  }
}

/** @param payloadJson 任务载荷 JSON。 @returns 运行 UUID。 */
function readRunId(payloadJson: string): string {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  if (typeof value.runId !== 'string') throw new Error('任务载荷缺少运行标识')
  return value.runId
}

/** @param error 未知执行异常。 @returns 稳定错误码和脱敏消息。 */
function normalizeExecutionError(error: unknown): { code: string, message: string, retryable: boolean } {
  if (error instanceof TextModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ApplicationError) return { code: error.code, message: error.message, retryable: false }
  if (error instanceof ZodError) return { code: 'MODEL_OUTPUT_INVALID', message: '模型结构化输出未通过校验', retryable: true }
  return { code: 'RUN_EXECUTION_FAILED', message: error instanceof Error ? error.message.slice(0, 500) : '运行执行失败', retryable: true }
}
