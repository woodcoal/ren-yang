import { ZodError } from 'zod'
import {
  feedbackClassificationSuggestionSchema,
  type ConfirmFeedbackClassificationInput,
  type SubmitFeedbackInput,
} from '../../../shared/schemas/feedback'
import type { FeedbackView } from '../../../shared/types/feedback'
import type { Clock } from '../../ports/Clock'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { FeedbackAggregate, FeedbackRepository } from '../../ports/FeedbackRepository'
import type { TextModelSnapshot } from '../../domain/generation/GenerationModels'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { TextModelPort } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import { ApplicationError } from '../errors/ApplicationError'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import type { AiAlgorithmApplicationService } from '../aiConfiguration/AiAlgorithmApplicationService'
import {
  buildFeedbackClassificationVariables,
  FEEDBACK_CLASSIFICATION_PROMPT_CODE,
} from './FeedbackPromptBuilder'

/** 反馈分类固定使用的确定性模型参数，不加载任何长期上下文。 */
export const FEEDBACK_MODEL_PARAMETERS = {
  temperature: 0,
  maxOutputTokens: 4_096,
  timeoutMs: 60_000,
  maxEvidenceChunks: 0,
  maxTextBlocks: 1,
  maxImageBlocks: 0,
  maxPromptCharacters: 120_000,
  maxTotalTokens: 50_000,
  maxBlockAttempts: 1,
  contextWindowTokens: 32_768,
  reservedOutputTokens: 8_192,
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

/** 反馈分类和人物成长素材确认所需依赖。 */
export interface FeedbackApplicationServiceDependencies {
  /** 反馈事件、确认结果和人物反馈资料事务事实源。 */
  repository: FeedbackRepository
  /** 固定分类文本模型。 */
  model: TextModelPort
  /** 全站已发布 AI 提示词目录。 */
  prompts: Pick<AiPromptApplicationService, 'render'>
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** OpenViking 启用时使用的 Session 与反馈资料投影队列。 */
  contextSyncQueue?: ContextSyncTaskQueue
  /** 反馈分类固定算法；未提供时仅供迁移前独立测试。 */
  algorithms?: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep'>
}

/** 编排反馈归因、一次性动作和显式人物成长素材创建。 */
export class FeedbackApplicationService {
  /**
   * 创建反馈应用服务。
   * @param dependencies 数据、模型、标识、时钟和可选投影队列。
   */
  constructor(private readonly dependencies: FeedbackApplicationServiceDependencies) {}

  /** @returns 新反馈在前的完整反馈历史。 */
  async listFeedback(): Promise<FeedbackView[]> {
    return (await this.dependencies.repository.listFeedback()).map(toFeedbackView)
  }

  /**
   * 调用固定文本模型建议反馈目标，并保存原始事件和可纠正建议。
   * @param runId 反馈所属运行 UUID。
   * @param input 已通过共享 Schema 校验的原始反馈。
   * @returns 尚待用户确认的反馈视图。
   */
  async submitFeedback(runId: string, input: SubmitFeedbackInput): Promise<FeedbackView> {
    const runPersona = await this.dependencies.repository.findRunPersona(runId)
    if (!runPersona) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈所属运行不存在', 404)
    }
    const blockId = input.blockId ?? null
    const variables = buildFeedbackClassificationVariables({
      content: input.content,
      blockId,
      isLongTerm: input.isLongTerm,
      editedOutput: input.editedOutput ?? null,
    })
    let model: TextModelSnapshot
    let parameters = { ...FEEDBACK_MODEL_PARAMETERS }
    let promptVersion: string
    let suggestion
    try {
      let response
      if (this.dependencies.algorithms) {
        const snapshot = await this.dependencies.algorithms.prepare('feedback_classification')
        const step = snapshot.steps.find(item => item.stepKey === 'classify')
        if (!step) throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '反馈分类算法步骤不存在', 409)
        model = {
          provider: 'openai_compatible' as const,
          model: step.model,
          endpointOrigin: new URL(step.endpoint).origin,
        }
        parameters = { ...parameters, ...step.parameters }
        promptVersion = step.promptVersionId
        response = await this.dependencies.algorithms.executeStep(
          snapshot,
          'classify',
          variables,
          'feedback_classification',
          'json_object',
          { subjectSnapshotHash: runPersona.personaVersionId },
        )
      }
      else {
        model = this.requireModel()
        const prompt = await this.dependencies.prompts.render(FEEDBACK_CLASSIFICATION_PROMPT_CODE, variables)
        promptVersion = prompt.versionId
        response = await this.dependencies.model.generateStructured({
          ...prompt,
          parameters,
          responseSchemaName: 'feedback_classification',
        })
      }
      suggestion = feedbackClassificationSuggestionSchema.parse(response.structuredOutput)
    }
    catch (error: unknown) {
      throw toModelApplicationError(error)
    }

    const timestamp = this.dependencies.clock.now()
    const feedbackId = this.dependencies.identifiers.create()
    const created = await this.dependencies.repository.createFeedback(
      {
        id: feedbackId,
        runId,
        blockId,
        content: input.content,
        rating: input.rating ?? null,
        isLongTerm: input.isLongTerm,
        editedOutput: input.editedOutput ?? null,
        createdAt: timestamp,
      },
      {
        feedbackId,
        ...suggestion,
        modelSnapshot: model,
        parameterSnapshot: parameters,
        promptVersion,
        createdAt: timestamp,
      },
    )
    if (!created) throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈目标产物块不属于当前运行', 404)
    if (this.dependencies.contextSyncQueue) {
      await this.dependencies.contextSyncQueue.enqueueSessionSynchronization(
        'feedback',
        feedbackId,
        this.dependencies.identifiers.create(),
        this.dependencies.clock.now(),
      )
    }
    return toFeedbackView((await this.dependencies.repository.findFeedback(feedbackId))!)
  }

  /**
   * 确认或纠正反馈目标，并且只执行该目标允许的业务动作。
   * @param feedbackId 反馈 UUID。
   * @param input 已确认目标及其必要参数。
   * @returns 保存动作结果后的反馈视图。
   */
  async confirmClassification(feedbackId: string, input: ConfirmFeedbackClassificationInput): Promise<FeedbackView> {
    const aggregate = await this.requireFeedback(feedbackId)
    if (aggregate.resolution) throw new ApplicationError('FEEDBACK_ALREADY_CLASSIFIED', '该反馈已经确认分类', 409)
    const timestamp = this.dependencies.clock.now()

    if (input.targetType === 'artifact') {
      const blockId = input.blockId ?? aggregate.event.blockId
      if (!blockId) throw new ApplicationError('VALIDATION_FAILED', '当前产物反馈必须指定产物块', 400)
      const accepted = await this.dependencies.repository.confirmArtifactFeedback(
        feedbackId,
        blockId,
        this.dependencies.identifiers.create(),
        timestamp,
      )
      if (!accepted) throw new ApplicationError('BLOCK_NOT_RETRYABLE', '目标块不存在、已锁定或当前不能重试', 409)
    }
    else if (input.targetType === 'parameters') {
      const accepted = await this.dependencies.repository.confirmSimpleFeedback(feedbackId, 'parameters', {
        recommendation: aggregate.event.content,
        scope: 'next_run_override',
      }, timestamp)
      if (!accepted) throw new ApplicationError('VERSION_CONFLICT', '反馈状态已经变化，请刷新后重试', 409)
    }
    else if (input.targetType === 'source_fact') {
      if (!input.sourceId || !await this.dependencies.repository.sourceExists(input.sourceId)) {
        throw new ApplicationError('RESOURCE_NOT_FOUND', '资料事实反馈必须指定有效资料', 404)
      }
      const accepted = await this.dependencies.repository.confirmSimpleFeedback(feedbackId, 'source_fact', {
        sourceId: input.sourceId,
        conflict: input.hasEvidenceConflict,
        recommendation: aggregate.event.content,
        automaticMindChange: false,
      }, timestamp)
      if (!accepted) throw new ApplicationError('VERSION_CONFLICT', '反馈状态已经变化，请刷新后重试', 409)
    }
    else {
      const runPersona = await this.dependencies.repository.findRunPersona(aggregate.event.runId)
      if (!runPersona) throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈所属运行或人物不存在', 404)
      const feedbackSourceId = this.dependencies.identifiers.create()
      const accepted = await this.dependencies.repository.confirmPersonaLearningFeedback({
        feedbackId,
        feedbackSourceId,
        personaId: runPersona.personaId,
        title: feedbackSourceTitle(aggregate.event.content),
        timestamp,
      })
      if (!accepted) throw new ApplicationError('VERSION_CONFLICT', '反馈状态或所属人物已经变化', 409)
      await this.enqueueFeedbackSourceSynchronization(feedbackSourceId)
    }

    return toFeedbackView((await this.dependencies.repository.findFeedback(feedbackId))!)
  }

  /** @param feedbackId 反馈 UUID。 @returns 存在的反馈聚合。 */
  private async requireFeedback(feedbackId: string): Promise<FeedbackAggregate> {
    const value = await this.dependencies.repository.findFeedback(feedbackId)
    if (!value) throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈不存在', 404)
    return value
  }

  /** @param sourceId 人物反馈资料 UUID。 @returns 能力关闭时直接结束，否则排队投影任务。 */
  private async enqueueFeedbackSourceSynchronization(sourceId: string): Promise<void> {
    if (!this.dependencies.contextSyncQueue) return
    await this.dependencies.contextSyncQueue.enqueueSourceSynchronization(
      sourceId,
      this.dependencies.identifiers.create(),
      this.dependencies.clock.now(),
      'persona_feedback_source',
    )
  }

  /** @returns 已配置文本模型的非敏感快照。 */
  private requireModel() {
    const model = this.dependencies.model.getConfiguredModel()
    if (!model) throw new ApplicationError('CAPABILITY_DISABLED', '反馈分类需要配置文本模型', 422)
    return model
  }
}

/** @param aggregate 反馈领域聚合。 @returns 不暴露模型参数的公开视图。 */
function toFeedbackView(aggregate: FeedbackAggregate): FeedbackView {
  return {
    id: aggregate.event.id,
    runId: aggregate.event.runId,
    blockId: aggregate.event.blockId,
    content: aggregate.event.content,
    rating: aggregate.event.rating,
    isLongTerm: aggregate.event.isLongTerm,
    editedOutput: aggregate.event.editedOutput,
    suggestion: {
      targetType: aggregate.suggestion.targetType,
      confidence: aggregate.suggestion.confidence,
      rationale: aggregate.suggestion.rationale,
    },
    confirmedTarget: aggregate.resolution?.targetType ?? null,
    resolution: aggregate.resolution?.resolution ?? null,
    createdAt: aggregate.event.createdAt,
    confirmedAt: aggregate.resolution?.confirmedAt ?? null,
  }
}

/** @param content 原始反馈正文。 @returns 便于在人物成长素材池辨认的标题。 */
function feedbackSourceTitle(content: string): string {
  const normalized = content.replaceAll(/\s+/g, ' ').trim()
  return `运行反馈：${normalized.length > 60 ? `${normalized.slice(0, 60)}…` : normalized}`
}

/** @param error 未知模型错误。 @returns 稳定且不泄露供应商响应的应用错误。 */
function toModelApplicationError(error: unknown): ApplicationError {
  if (error instanceof TextModelError) {
    const status = error.code === 'CAPABILITY_DISABLED' ? 422 : error.code === 'MODEL_OUTPUT_INVALID' ? 502 : 503
    return new ApplicationError(error.code, error.message, status)
  }
  if (error instanceof ZodError) return new ApplicationError('MODEL_OUTPUT_INVALID', '模型结构化输出未通过校验', 502)
  return new ApplicationError('PROVIDER_UNAVAILABLE', '文本模型调用失败', 503)
}
