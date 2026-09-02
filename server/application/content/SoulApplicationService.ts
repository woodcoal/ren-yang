import { analyzedSoulPromptSchema, type CreateSoulDraftFromVersionInput, type SaveSoulDraftInput, type SaveSoulVersionInput } from '../../../shared/schemas/content'
import type { TextModelParameters } from '../../../shared/schemas/generation'
import type { SoulDraftView, SoulSnapshot, SoulVersionView, SoulWorkspaceView } from '../../../shared/types/content'
import type { SoulDraftRecord, SoulSubjectType, SoulVersionRecord } from '../../domain/content/ContentModels'
import { normalizeSoulSnapshot } from '../../domain/content/SoulRules'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { SoulRepository } from '../../ports/SoulRepository'
import type { TextModelPort } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { TokenCounter } from '../../ports/TokenCounter'
import { ApplicationError } from '../errors/ApplicationError'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import type { AiAlgorithmApplicationService } from '../aiConfiguration/AiAlgorithmApplicationService'
import { buildSoulPromptAnalysisVariables, soulAnalysisPromptCode } from './SoulPromptBuilder'

/** 灵魂文本整理使用的固定、低随机性模型参数。 */
const SOUL_ANALYSIS_PARAMETERS: TextModelParameters = {
  temperature: 0.2,
  maxOutputTokens: 4_096,
  timeoutMs: 60_000,
  maxEvidenceChunks: 0,
  maxTextBlocks: 1,
  maxImageBlocks: 0,
  maxPromptCharacters: 70_000,
  maxTotalTokens: 10_000,
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
  sourceBudgetTokens: 0,
}

/** 灵魂保存为当前版本时使用的最小预算配置。 */
export interface SoulTokenBudgets {
  /** 世界灵魂提示词最多可占 Token。 */
  world: number
  /** 人物灵魂提示词最多可占 Token。 */
  persona: number
}

/** 灵魂应用服务的全部外部依赖。 */
export interface SoulApplicationServiceDependencies {
  /** 模拟对象元数据事实源。 */
  content: Pick<ContentRepository, 'findWorld' | 'findPersona'>
  /** 灵魂草稿与版本事实源。 */
  souls: SoulRepository
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 保存灵魂版本时使用的 Token 计数端口。 */
  tokenCounter: TokenCounter
  /** 可选执行灵魂文本整理的模型端口。 */
  model?: TextModelPort
  /** 全站已发布 AI 提示词目录。 */
  prompts: Pick<AiPromptApplicationService, 'render'>
  /** 世界与人物灵魂提示词预算。 */
  tokenBudgets: SoulTokenBudgets
  /** 数据库配置的灵魂整理算法；未提供时兼容独立测试和旧组合方式。 */
  algorithms?: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep'>
}

/** 管理世界与人物共用的当前灵魂、不可变历史版本和旧草稿兼容流程。 */
export class SoulApplicationService {
  /**
   * 创建灵魂应用服务。
   * @param dependencies 元数据、灵魂事实源、标识、时间、计数和预算端口。
   */
  constructor(private readonly dependencies: SoulApplicationServiceDependencies) {}

  /**
   * 查询指定模拟对象的灵魂工作区。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 当前版本、草稿和历史版本。
   */
  async getSoul(subjectType: SoulSubjectType, subjectId: string): Promise<SoulWorkspaceView> {
    const activeVersionId = await this.requireSubject(subjectType, subjectId)
    const [draft, versions] = await Promise.all([
      this.dependencies.souls.findSoulDraft(subjectType, subjectId),
      this.dependencies.souls.listSoulVersions(subjectType, subjectId),
    ])
    return {
      subjectType,
      subjectId,
      activeVersion: versions.find(version => version.id === activeVersionId) ?? null,
      draft: draft ? toSoulDraftView(draft) : null,
      versions: versions.map(toSoulVersionView),
    }
  }

  /**
   * 保存新的不可变灵魂历史版本并立即设为当前使用版本。
   * @param subjectType 世界或人物类型。
   * @param subjectId 对象 UUID。
   * @param input 用户编辑后的单文本提示词和可选历史基线。
   * @returns 已经成为当前版本的完整公开视图。
   */
  async saveVersion(
    subjectType: SoulSubjectType,
    subjectId: string,
    input: SaveSoulVersionInput,
  ): Promise<SoulVersionView> {
    const activeVersionId = await this.requireSubject(subjectType, subjectId)
    await this.requireOptionalBaseVersion(subjectType, subjectId, input.baseVersionId)
    const snapshot = normalizeSoulSnapshot(input.snapshot)
    const count = this.dependencies.tokenCounter.count(null, snapshot.promptText)
    const budget = this.dependencies.tokenBudgets[subjectType]
    if (count.tokens > budget) {
      throw new ApplicationError(
        'SOUL_TOKEN_BUDGET_EXCEEDED',
        `灵魂提示词预计 ${count.tokens} Token，超过当前 ${budget} Token 限制，请先精简文本`,
        422,
      )
    }
    const timestamp = this.dependencies.clock.now()
    const baseVersionId = input.baseVersionId ?? activeVersionId
    const version = await this.dependencies.souls.saveSoulVersion({
      version: {
        id: this.dependencies.identifiers.create(),
        subjectType,
        subjectId,
        parentVersionId: baseVersionId,
        status: 'published',
        snapshot,
        runtimeTokenCount: count.tokens,
        tokenCounter: count.counter,
        changeSummary: baseVersionId && activeVersionId && baseVersionId !== activeVersionId
          ? '回溯历史提示词并保存'
          : '修改灵魂提示词',
        publishedAt: timestamp,
        createdAt: timestamp,
      },
    })
    if (!version) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', subjectType === 'world' ? '世界不存在' : '人物不存在', 404)
    }
    return toSoulVersionView(version)
  }

  /**
   * 创建或覆盖指定对象当前唯一灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param input 基础版本、单文本提示词和可选自动整理标记。
   * @returns 保存后的草稿。
   */
  async saveDraft(subjectType: SoulSubjectType, subjectId: string, input: SaveSoulDraftInput): Promise<SoulDraftView> {
    await this.requireSubject(subjectType, subjectId)
    await this.requireOptionalBaseVersion(subjectType, subjectId, input.baseVersionId)
    const existing = await this.dependencies.souls.findSoulDraft(subjectType, subjectId)
    const snapshot = input.autoAnalyze
      ? await this.analyzePrompt(subjectType, input.snapshot.promptText)
      : normalizeSoulSnapshot(input.snapshot)
    const timestamp = this.dependencies.clock.now()
    const draft = await this.dependencies.souls.saveSoulDraft({
      id: existing?.id ?? this.dependencies.identifiers.create(),
      subjectType,
      subjectId,
      baseVersionId: input.baseVersionId,
      snapshot,
      changeSummary: input.autoAnalyze ? 'AI 整理灵魂提示词' : '手动修改灵魂提示词',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    return toSoulDraftView(draft)
  }

  /**
   * 删除指定对象尚未发布的灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 无返回值。
   */
  async deleteDraft(subjectType: SoulSubjectType, subjectId: string): Promise<void> {
    await this.requireSubject(subjectType, subjectId)
    const deleted = await this.dependencies.souls.deleteSoulDraft(subjectType, subjectId)
    if (deleted !== 1) {
      throw new ApplicationError('SOUL_DRAFT_NOT_FOUND', '当前没有可删除的灵魂草稿', 404)
    }
  }

  /**
   * 从指定历史发布版本完整复制一份新的可编辑草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param input 待复制的历史版本标识。
   * @returns 新的当前草稿。
   */
  async createDraftFromVersion(
    subjectType: SoulSubjectType,
    subjectId: string,
    input: CreateSoulDraftFromVersionInput,
  ): Promise<SoulDraftView> {
    await this.requireSubject(subjectType, subjectId)
    const version = await this.requireOwnedVersion(subjectType, subjectId, input.versionId)
    const existing = await this.dependencies.souls.findSoulDraft(subjectType, subjectId)
    const timestamp = this.dependencies.clock.now()
    const draft = await this.dependencies.souls.saveSoulDraft({
      id: existing?.id ?? this.dependencies.identifiers.create(),
      subjectType,
      subjectId,
      baseVersionId: version.id,
      snapshot: normalizeSoulSnapshot(version.snapshot),
      changeSummary: `基于“${version.changeSummary}”继续修改`,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    return toSoulDraftView(draft)
  }

  /**
   * 校验预算并原子发布当前草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 新发布的不可变灵魂版本。
   */
  async publishDraft(subjectType: SoulSubjectType, subjectId: string): Promise<SoulVersionView> {
    const activeVersionId = await this.requireSubject(subjectType, subjectId)
    const draft = await this.dependencies.souls.findSoulDraft(subjectType, subjectId)
    if (!draft) {
      const activeVersion = activeVersionId ? await this.dependencies.souls.findSoulVersion(activeVersionId) : null
      if (activeVersion) return toSoulVersionView(activeVersion)
      throw new ApplicationError('SOUL_DRAFT_NOT_FOUND', '当前没有可发布的灵魂草稿', 404)
    }
    const count = this.dependencies.tokenCounter.count(null, draft.snapshot.promptText)
    const budget = this.dependencies.tokenBudgets[subjectType]
    if (count.tokens > budget) {
      throw new ApplicationError(
        'SOUL_TOKEN_BUDGET_EXCEEDED',
        `灵魂提示词预计 ${count.tokens} Token，超过当前 ${budget} Token 限制，请先精简文本`,
        422,
      )
    }
    const version = await this.dependencies.souls.publishSoulDraft({
      draftId: draft.id,
      versionId: this.dependencies.identifiers.create(),
      runtimeTokenCount: count.tokens,
      tokenCounter: count.counter,
      timestamp: this.dependencies.clock.now(),
    })
    if (!version) {
      throw new ApplicationError('SOUL_DRAFT_CONFLICT', '草稿已经变化，请刷新后重试', 409)
    }
    return toSoulVersionView(version)
  }

  /**
   * 校验对象存在并返回当前灵魂版本标识。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 当前灵魂版本标识或 null。
   */
  private async requireSubject(subjectType: SoulSubjectType, subjectId: string): Promise<string | null> {
    const subject = subjectType === 'world'
      ? await this.dependencies.content.findWorld(subjectId)
      : await this.dependencies.content.findPersona(subjectId)
    if (!subject) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', subjectType === 'world' ? '世界不存在' : '人物不存在', 404)
    }
    return subject.activeVersionId
  }

  /**
   * 校验可选基础版本属于指定模拟对象。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param versionId 可选基础版本 UUID。
   * @returns 无返回值。
   */
  private async requireOptionalBaseVersion(
    subjectType: SoulSubjectType,
    subjectId: string,
    versionId: string | null,
  ): Promise<void> {
    if (versionId === null) return
    await this.requireOwnedVersion(subjectType, subjectId, versionId)
  }

  /**
   * 查询并校验灵魂版本归属。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param versionId 版本 UUID。
   * @returns 归属正确的灵魂版本。
   */
  private async requireOwnedVersion(
    subjectType: SoulSubjectType,
    subjectId: string,
    versionId: string,
  ): Promise<SoulVersionRecord> {
    const version = await this.dependencies.souls.findSoulVersion(versionId)
    if (!version || version.subjectType !== subjectType || version.subjectId !== subjectId) {
      throw new ApplicationError('VERSION_CONFLICT', '基础灵魂版本不属于当前对象', 409)
    }
    return version
  }

  /**
   * 使用文本模型把用户原始灵魂整理为不增加事实的标准化纯文本。
   * @param subjectType 世界或人物，用于选择整理侧重点。
   * @param promptText 用户输入的原始灵魂提示词。
   * @returns 已校验并规范化的单文本灵魂快照。
   */
  async analyzePrompt(subjectType: SoulSubjectType, promptText: string): Promise<SoulSnapshot> {
    const model = this.dependencies.model
    if (!this.dependencies.algorithms && !model?.getConfiguredModel()) {
      throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置，不能自动分析灵魂提示词', 422)
    }
    try {
      const response = this.dependencies.algorithms
        ? await this.executeConfiguredSoulAlgorithm(subjectType, promptText)
        : await this.executeLegacySoulAnalysis(model!, subjectType, promptText)
      return normalizeSoulSnapshot(analyzedSoulPromptSchema.parse(response.structuredOutput))
    }
    catch (error: unknown) {
      if (error instanceof ApplicationError) throw error
      if (error instanceof TextModelError) {
        const statusCode = error.code === 'CAPABILITY_DISABLED' ? 422 : error.code === 'MODEL_OUTPUT_INVALID' ? 502 : 503
        throw new ApplicationError(error.code, error.message, statusCode)
      }
      throw new ApplicationError('MODEL_OUTPUT_INVALID', '模型返回的灵魂提示词格式无效', 502)
    }
  }

  /**
   * 使用数据库当前配置准备快照并执行人物或世界灵魂整理步骤。
   * @param subjectType 世界或人物。
   * @param promptText 用户提供的灵魂原文。
   * @returns 结构化模型响应。
   */
  private async executeConfiguredSoulAlgorithm(subjectType: SoulSubjectType, promptText: string) {
    const algorithmCode = subjectType === 'world' ? 'world_soul' : 'persona_soul'
    const snapshot = await this.dependencies.algorithms!.prepare(algorithmCode)
    return await this.dependencies.algorithms!.executeStep(
      snapshot,
      'organize',
      buildSoulPromptAnalysisVariables(promptText),
      'soul_prompt_analysis',
      'json_object',
      {
        limits: SOUL_ANALYSIS_PARAMETERS,
        validateStructuredOutput: value => { analyzedSoulPromptSchema.parse(value) },
      },
    )
  }

  /**
   * 保持独立测试及旧组合根使用单一环境文本模型的兼容路径。
   * @param model 已配置的旧文本模型端口。
   * @param subjectType 世界或人物。
   * @param promptText 用户提供的灵魂原文。
   * @returns 结构化模型响应。
   */
  private async executeLegacySoulAnalysis(model: TextModelPort, subjectType: SoulSubjectType, promptText: string) {
    const prompt = await this.dependencies.prompts.render(
      soulAnalysisPromptCode(subjectType),
      buildSoulPromptAnalysisVariables(promptText),
    )
    return await model.generateStructured({
      ...prompt,
      parameters: { ...SOUL_ANALYSIS_PARAMETERS },
      responseSchemaName: 'soul_prompt_analysis',
    })
  }
}

/**
 * 把领域草稿复制为共享公开视图。
 * @param draft 领域草稿。
 * @returns 不暴露持久层字段的草稿视图。
 */
function toSoulDraftView(draft: SoulDraftRecord): SoulDraftView {
  return { ...draft, snapshot: normalizeSoulSnapshot(draft.snapshot) }
}

/**
 * 把领域版本复制为共享公开视图。
 * @param version 领域灵魂版本。
 * @returns 不暴露持久层字段的版本视图。
 */
function toSoulVersionView(version: SoulVersionRecord): SoulVersionView {
  return { ...version, snapshot: normalizeSoulSnapshot(version.snapshot) }
}
