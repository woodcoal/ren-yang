import { createHash } from 'node:crypto'
import {
  confirmPersonaDistillationCandidateSchema,
  createPersonaDistillationSchema,
  restartPersonaDistillationSchema,
  savePersonaDistillationCandidateSchema,
} from '../../../shared/schemas/personaDistillation'
import type {
  ConfirmPersonaDistillationCandidateInput,
  CreatePersonaDistillationInput,
  RestartPersonaDistillationInput,
  SavePersonaDistillationCandidateInput,
} from '../../../shared/schemas/personaDistillation'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { assertPersonaDistillationCandidateConfirmable, PersonaDistillationRuleError } from '../../domain/distillation/PersonaDistillation'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { AiAlgorithmApplicationService } from '../aiConfiguration/AiAlgorithmApplicationService'
import { ApplicationError } from '../errors/ApplicationError'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { ContextProvider } from '../../ports/ContextProvider'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { DistillationRepository, PersonaDistillationRunRecord } from '../../ports/DistillationRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import { TextModelError } from '../../ports/TextModelPort'
import type { TokenCounter } from '../../ports/TokenCounter'

/** 单次人物蒸馏允许固定到运行中的资料正文总字符数。 */
const MAX_DISTILLATION_SOURCE_CHARACTERS = 120_000
/** 为完整资料、分析报告和候选灵魂预留空间后的资料最大估算 Token。 */
const MAX_DISTILLATION_SOURCE_TOKENS = 48_000

/** 人物蒸馏应用服务依赖。 */
export interface PersonaDistillationApplicationServiceDependencies {
  /** 人物、灵魂版本、世界和资料查询。 */
  content: Pick<ContentRepository, 'findPersona' | 'findPersonaVersion' | 'findWorld' | 'findSource'>
  /** 人物蒸馏运行和最终确认事实源。 */
  distillations: DistillationRepository
  /** 内部纯文本分析与灵魂编写算法准备和执行入口。 */
  algorithms: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep'>
  /** 新运行和任务标识生成器。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 候选灵魂发布前 Token 计数器。 */
  tokenCounter: TokenCounter
  /** 人物灵魂硬 Token 上限。 */
  personaSoulTokenBudget: number
  /** 创建运行时固定实际上下文提供器。 */
  context: Pick<ContextProvider, 'getProvider'>
  /** 人物确认后补排资料与 User 对账的可选同步意图。 */
  contextSyncQueue?: Pick<ContextSyncTaskQueue, 'enqueueSourceSynchronization' | 'enqueueUserReconciliation'>
}

/** 创建、执行、人工校准和确认内部两段纯文本蒸馏运行。 */
export class PersonaDistillationApplicationService implements TaskHandler {
  /** @param dependencies 内容、蒸馏、算法、标识、时间、预算和上下文接缝。 */
  constructor(private readonly dependencies: PersonaDistillationApplicationServiceDependencies) {}

  /** @param input 创建输入。 @returns 已排队执行单次自由分析的运行。 */
  async createRun(input: CreatePersonaDistillationInput): Promise<PersonaDistillationRunRecord> {
    const parsed = createPersonaDistillationSchema.parse(input)
    if (parsed.worldId) {
      const world = await this.dependencies.content.findWorld(parsed.worldId)
      if (!world) throw new ApplicationError('RESOURCE_NOT_FOUND', '人物蒸馏选择的世界不存在', 404)
      if (!world.isEnabled) throw new ApplicationError('RESOURCE_DISABLED', '人物蒸馏选择的世界已停用', 409)
    }
    return await this.createPreparedRun({
      mode: 'create', createdPersonaId: null, baseSoulVersionId: null, currentSoulPromptText: null,
      requestedName: parsed.requestedName, objective: parsed.objective, worldId: parsed.worldId, sourceIds: parsed.sourceIds,
    })
  }

  /** @param personaId 目标人物 UUID。 @param input 本次聚焦方向和资料。 @returns 已排队的更新运行。 */
  async restartRun(personaId: string, input: RestartPersonaDistillationInput): Promise<PersonaDistillationRunRecord> {
    const parsed = restartPersonaDistillationSchema.parse(input)
    const persona = await this.dependencies.content.findPersona(personaId)
    if (!persona) throw new ApplicationError('RESOURCE_NOT_FOUND', '重新蒸馏的人物不存在', 404)
    if (!persona.activeVersionId) throw new ApplicationError('RESOURCE_NOT_FOUND', '重新蒸馏需要人物已有当前灵魂', 409)
    const activeVersion = await this.dependencies.content.findPersonaVersion(persona.activeVersionId)
    if (!activeVersion || activeVersion.personaId !== persona.id) {
      throw new ApplicationError('VERSION_CONFLICT', '人物当前灵魂版本已变化', 409)
    }
    return await this.createPreparedRun({
      mode: 'update', createdPersonaId: persona.id, baseSoulVersionId: activeVersion.id,
      currentSoulPromptText: activeVersion.snapshot.promptText, requestedName: persona.name,
      objective: parsed.objective, worldId: persona.worldId, sourceIds: parsed.sourceIds,
    })
  }

  /** @param input 已确定模式、基线与资料的内部命令。 @returns 已持久化运行。 */
  private async createPreparedRun(input: {
    mode: 'create' | 'update'
    createdPersonaId: string | null
    baseSoulVersionId: string | null
    currentSoulPromptText: string | null
    requestedName: string
    objective: string
    worldId: string | null
    sourceIds: string[]
  }): Promise<PersonaDistillationRunRecord> {
    const sourceIds = [...new Set(input.sourceIds)]
    const sources = await Promise.all(sourceIds.map(async (sourceId) => {
      const source = await this.dependencies.content.findSource(sourceId)
      if (!source) throw new ApplicationError('RESOURCE_NOT_FOUND', '人物蒸馏选择的资料不存在', 404)
      if (!source.isEnabled) throw new ApplicationError('RESOURCE_DISABLED', `资料“${source.name}”已停用`, 409)
      return source
    }))
    const sourceCharacters = sources.reduce((total, source) => total + source.contentText.length, 0)
    if (sourceCharacters > MAX_DISTILLATION_SOURCE_CHARACTERS) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '人物蒸馏资料正文超过 120000 字，请减少资料或先精简正文', 422)
    }
    const sourceTokenCount = this.dependencies.tokenCounter.count(null, sources.map(source => source.contentText).join('\n')).tokens
    if (sourceTokenCount > MAX_DISTILLATION_SOURCE_TOKENS) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '人物蒸馏资料预计超过模型可用输入预算，请减少资料或先精简正文', 422)
    }
    const algorithmSnapshot = await this.dependencies.algorithms.prepare('persona_distillation')
    const runId = this.dependencies.identifiers.create()
    const timestamp = this.dependencies.clock.now()
    await this.dependencies.distillations.createRun({
      id: runId,
      taskId: this.dependencies.identifiers.create(),
      retryOfRunId: null,
      mode: input.mode,
      createdPersonaId: input.createdPersonaId,
      baseSoulVersionId: input.baseSoulVersionId,
      requestedName: input.requestedName,
      objective: input.objective,
      worldId: input.worldId,
      provider: this.dependencies.context.getProvider(),
      algorithmSnapshot,
      inputs: [
        {
          id: this.dependencies.identifiers.create(), inputType: 'user_statement', sourceId: null,
          name: input.mode === 'update' ? '本次重新蒸馏要求' : '用户创建要求', sourceRole: null,
          independentSourceKey: `requirement:${runId}`, contentHash: hashText(input.objective), contentSnapshot: input.objective,
          originUrl: null, authorName: null, publishedAt: null,
        },
        ...(input.currentSoulPromptText && input.baseSoulVersionId ? [{
          id: this.dependencies.identifiers.create(), inputType: 'user_statement' as const, sourceId: null,
          name: '当前人物灵魂', sourceRole: null, independentSourceKey: `soul-version:${input.baseSoulVersionId}`,
          contentHash: hashText(input.currentSoulPromptText), contentSnapshot: input.currentSoulPromptText,
          originUrl: null, authorName: null, publishedAt: null,
        }] : []),
        ...sources.map(source => ({
          id: this.dependencies.identifiers.create(), inputType: 'source_material' as const, sourceId: source.id,
          name: source.name, sourceRole: source.role, independentSourceKey: source.originalSourceKey,
          contentHash: source.contentHash, contentSnapshot: source.contentText,
          originUrl: source.originUrl, authorName: source.authorName, publishedAt: source.publishedAt,
        })),
      ],
      timestamp,
    })
    return await this.requireRun(runId)
  }

  /** @param runId 运行 UUID。 @returns 完整可审计运行。 */
  async getRun(runId: string): Promise<PersonaDistillationRunRecord> {
    return await this.requireRun(runId)
  }

  /** @param runId 运行 UUID。 @param input 编辑后的完整候选。 @returns 更新后运行。 */
  async saveCandidate(runId: string, input: SavePersonaDistillationCandidateInput): Promise<PersonaDistillationRunRecord> {
    const parsed = savePersonaDistillationCandidateSchema.parse(input)
    const candidatePromptHash = hashText(parsed.promptText)
    const saved = await this.dependencies.distillations.saveCandidate({
      runId, expectedUpdatedAt: parsed.expectedUpdatedAt, candidatePromptText: parsed.promptText,
      candidatePromptHash, timestamp: this.dependencies.clock.now(),
    })
    if (!saved) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏候选状态已经变化', 409)
    return await this.requireRun(runId)
  }

  /** @param runId 运行 UUID。 @param input 并发版本、名称和候选哈希。 @returns 已确认运行。 */
  async confirmCandidate(runId: string, input: ConfirmPersonaDistillationCandidateInput): Promise<PersonaDistillationRunRecord> {
    const parsed = confirmPersonaDistillationCandidateSchema.parse(input)
    const run = await this.requireRun(runId)
    try {
      assertPersonaDistillationCandidateConfirmable({
        status: run.status, candidatePromptHash: run.candidatePromptHash, preparedPromptHash: run.preparedPromptHash,
      })
    }
    catch (error: unknown) {
      if (error instanceof PersonaDistillationRuleError) throw new ApplicationError(error.code, error.message, 409)
      throw error
    }
    if (!run.candidatePromptText) throw new ApplicationError('DISTILLATION_CANDIDATE_NOT_PREPARED', '人物候选正文不存在', 409)
    const count = this.dependencies.tokenCounter.count(null, run.candidatePromptText)
    if (count.tokens > this.dependencies.personaSoulTokenBudget) {
      throw new ApplicationError('SOUL_TOKEN_BUDGET_EXCEEDED', `人物灵魂预计 ${count.tokens} Token，超过当前 ${this.dependencies.personaSoulTokenBudget} Token 限制`, 422)
    }
    const targetPersonaId = run.mode === 'update' ? run.createdPersonaId : this.dependencies.identifiers.create()
    if (!targetPersonaId || (run.mode === 'update' && !run.baseSoulVersionId)) {
      throw new ApplicationError('VERSION_CONFLICT', '重新蒸馏的目标人物或基线灵魂已变化', 409)
    }
    const confirmed = await this.dependencies.distillations.confirmCandidate({
      runId, expectedUpdatedAt: parsed.expectedUpdatedAt, expectedPromptHash: parsed.expectedPromptHash,
      personaId: targetPersonaId, soulVersionId: this.dependencies.identifiers.create(), name: parsed.name,
      runtimeTokenCount: count.tokens, tokenCounter: count.counter, timestamp: this.dependencies.clock.now(),
    })
    if (!confirmed) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏候选确认状态已经变化', 409)
    const completed = await this.requireRun(runId)
    await this.enqueueConfirmedSources(completed)
    return completed
  }

  /** @param runId 运行 UUID。 @returns 取消请求后的运行。 */
  async cancelRun(runId: string): Promise<PersonaDistillationRunRecord> {
    if (!await this.dependencies.distillations.requestCancellation(runId, this.dependencies.clock.now())) {
      throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '当前人物蒸馏状态不能取消', 409)
    }
    return await this.requireRun(runId)
  }

  /** @param runId 失败运行 UUID。 @returns 使用固定输入和快照的新运行。 */
  async retryRun(runId: string): Promise<PersonaDistillationRunRecord> {
    const source = await this.requireRun(runId)
    const newRunId = this.dependencies.identifiers.create()
    const retried = await this.dependencies.distillations.createRetry({
      sourceRunId: runId, runId: newRunId, taskId: this.dependencies.identifiers.create(),
      inputIds: source.inputs.map(() => this.dependencies.identifiers.create()), timestamp: this.dependencies.clock.now(),
    })
    if (!retried) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏运行不可重试或原输入已不可用', 409)
    return await this.requireRun(newRunId)
  }

  /** @param job 已领取的人物蒸馏任务。 @returns 内部分析和灵魂编写完成时结束。 */
  async execute(job: TaskJob): Promise<void> {
    if (job.type !== 'distill_persona') throw new TaskExecutionError('未知人物蒸馏任务', false)
    const runId = readDistillationRunId(job.payloadJson)
    try {
      if (await this.stopIfCancellationRequested(runId)) return
      const run = await this.requireRun(runId)
      if (run.status !== 'analyzing') return
      await this.executeFreeformAnalysis(run)
    }
    catch (error: unknown) {
      const normalized = normalizeDistillationError(error)
      if (!normalized.retryable || job.attemptCount >= job.maxAttempts) {
        await this.dependencies.distillations.failRun(runId, normalized.code, normalized.message, this.dependencies.clock.now())
      }
      throw new TaskExecutionError(normalized.message, normalized.retryable)
    }
  }

  /** @param run 当前运行。 @returns 自由分析文本和基于其编写的灵魂保存完成时结束。 */
  private async executeFreeformAnalysis(run: PersonaDistillationRunRecord): Promise<void> {
    const inputs = run.inputs.filter(input => input.sourceAvailable && input.contentSnapshot !== null)
    const analysis = await this.dependencies.algorithms.executeStep(
      run.algorithmSnapshot as AiAlgorithmSnapshot,
      'analyze',
      {
        objectiveJson: JSON.stringify(run.objective),
        inputsJson: JSON.stringify(inputs.map(toModelInput)),
      },
      'persona_distillation_analysis',
      'text',
    )
    if (await this.stopIfCancellationRequested(run.id)) return
    const analysisReport = analysis.structuredOutput
    if (typeof analysisReport !== 'string' || analysisReport.trim().length === 0) {
      throw new ApplicationError('MODEL_OUTPUT_INVALID', '人物蒸馏分析未返回文本', 502)
    }
    const composition = await this.dependencies.algorithms.executeStep(
      run.algorithmSnapshot as AiAlgorithmSnapshot,
      'compose',
      {
        objectiveJson: JSON.stringify(run.objective),
        analysisTextJson: JSON.stringify(analysisReport),
      },
      'persona_distillation_soul',
      'text',
    )
    if (await this.stopIfCancellationRequested(run.id)) return
    const candidatePromptText = composition.structuredOutput
    if (typeof candidatePromptText !== 'string' || candidatePromptText.trim().length === 0) {
      throw new ApplicationError('MODEL_OUTPUT_INVALID', '人物蒸馏灵魂编写未返回文本', 502)
    }
    const saved = await this.dependencies.distillations.saveAnalysis({
      runId: run.id,
      rawResult: { analysisReport, candidatePromptText },
      analysisReport,
      candidateName: run.requestedName,
      candidatePromptText,
      candidatePromptHash: hashText(candidatePromptText),
      timestamp: this.dependencies.clock.now(),
    })
    if (!saved) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏运行状态已经变化', 409)
  }

  /** @param runId 运行 UUID。 @returns 存在时返回运行，否则抛出稳定错误。 */
  private async requireRun(runId: string): Promise<PersonaDistillationRunRecord> {
    const run = await this.dependencies.distillations.findRun(runId)
    if (!run) throw new ApplicationError('DISTILLATION_NOT_FOUND', '人物蒸馏运行不存在', 404)
    return run
  }

  /** @param runId 运行 UUID。 @returns 已请求取消并完成安全取消时为 true。 */
  private async stopIfCancellationRequested(runId: string): Promise<boolean> {
    if (!await this.dependencies.distillations.isCancellationRequested(runId)) return false
    await this.dependencies.distillations.markRunCanceled(runId, this.dependencies.clock.now())
    return true
  }

  /** @param run 已完成人物创建的运行。 @returns 同步意图保存完成时结束。 */
  private async enqueueConfirmedSources(run: PersonaDistillationRunRecord): Promise<void> {
    const queue = this.dependencies.contextSyncQueue
    if (!queue) return
    const sourceIds = [...new Set(run.inputs
      .filter(input => input.inputType === 'source_material' && input.sourceAvailable && input.sourceId)
      .map(input => input.sourceId)
      .filter((sourceId): sourceId is string => sourceId !== null))]
    const timestamp = this.dependencies.clock.now()
    for (const sourceId of sourceIds) {
      await queue.enqueueSourceSynchronization(sourceId, this.dependencies.identifiers.create(), timestamp)
    }
    await queue.enqueueUserReconciliation(this.dependencies.identifiers.create(), timestamp)
  }
}

/** @param input 持久化输入。 @returns 只包含模型所需字段的不可信输入。 */
function toModelInput(input: PersonaDistillationRunRecord['inputs'][number]) {
  return {
    id: input.id,
    inputType: input.inputType,
    name: input.name,
    sourceRole: input.sourceRole,
    independentSourceKey: input.independentSourceKey,
    content: input.contentSnapshot,
    originUrl: input.originUrl,
    authorName: input.authorName,
    publishedAt: input.publishedAt,
  }
}

/** @param value UTF-8 文本。 @returns 小写十六进制 SHA-256。 */
function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** @param payloadJson 任务载荷。 @returns 人物蒸馏运行 UUID。 */
function readDistillationRunId(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    if (!parsed || typeof parsed !== 'object' || !('distillationRunId' in parsed)
      || typeof parsed.distillationRunId !== 'string') throw new Error('invalid')
    return parsed.distillationRunId
  }
  catch {
    throw new TaskExecutionError('人物蒸馏任务载荷无效', false)
  }
}

/** @param error 未知执行错误。 @returns 可安全持久化的错误码、说明和重试语义。 */
function normalizeDistillationError(error: unknown): { code: string, message: string, retryable: boolean } {
  if (error instanceof TextModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ApplicationError) return { code: error.code, message: error.message, retryable: error.statusCode >= 500 }
  return { code: 'MODEL_OUTPUT_INVALID', message: '人物蒸馏模型输出或执行结果无效', retryable: false }
}
