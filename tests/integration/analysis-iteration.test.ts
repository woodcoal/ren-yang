import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { AnalysisApplicationService } from '../../server/application/analysis/AnalysisApplicationService'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { SoulApplicationService } from '../../server/application/content/SoulApplicationService'
import { LearningApplicationService } from '../../server/application/learning/LearningApplicationService'
import { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteAnalysisRepository } from '../../server/infrastructure/database/SqliteAnalysisRepository'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteLearningRepository } from '../../server/infrastructure/database/SqliteLearningRepository'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'
import { ConservativeTokenCounter } from '../../server/infrastructure/model/ConservativeTokenCounter'
import type { Clock } from '../../server/ports/Clock'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import { createTestAiPromptService } from '../support/createTestAiPromptService'
import type { AiAlgorithmSnapshot } from '../../server/domain/ai/AiAlgorithmModels'
import type { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'

/** 提供稳定 UUID 的分析测试标识器。 */
class SequentialIdentifierGenerator implements IdentifierGenerator {
  /** 当前序号。 */
  private sequence = 0

  /** @returns 下一个稳定 UUID。 */
  create(): string {
    this.sequence += 1
    return `60000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

/** 提供单调递增时间的分析测试时钟。 */
class TestClock implements Clock {
  /** 当前时间。 */
  private timestamp = 20_000

  /** @returns 下一毫秒时间。 */
  now(): number {
    this.timestamp += 1
    return this.timestamp
  }
}

/** 返回一份完整世界成长提示词草稿的固定测试模型。 */
class AnalysisTextModel implements TextModelPort {
  /** 收到的最后一次模型请求。 */
  lastRequest: TextModelRequest | null = null

  /** @returns 固定非敏感模型快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible' as const, model: 'analysis-test-model', endpointOrigin: 'https://model.test' }
  }

  /**
   * 返回符合学习提炼契约的纯文本完整草稿。
   * @param request 学习分析请求。
   * @returns 固定完整提示词正文。
   */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    this.lastRequest = request
    return {
      structuredOutput: '进行城邦规划时，优先保障稳定水运，并明确区分确定事实与推断。',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    }
  }
}

/** 模拟已配置的两阶段成长算法并记录综合步骤收到的去重结论。 */
class TwoStageGrowthAlgorithms {
  /** 综合步骤收到的程序校验后结论。 */
  public synthesizedFacts: unknown[] = []
  /** 综合步骤实际调用次数。 */
  public synthesizeCallCount = 0

  /** 是否首次返回批次外的成长资料标识。 */
  public invalidEvidenceOnce = false
  /** @param emptyExtraction 是否让提取步骤返回明确的空事实集合。 */
  constructor(private readonly emptyExtraction = false) {}

  /** @param code 世界或人物成长算法编码。 @returns 固定非敏感配置快照。 */
  async prepare(code: 'world_growth' | 'persona_growth'): Promise<AiAlgorithmSnapshot> {
    return {
      algorithmCode: code,
      implementationVersion: 1,
      configurationVersionId: '70000000-0000-4000-8000-000000000001',
      configurationVersion: 3,
      steps: [
        {
          stepKey: 'extract', ordinal: 0, modelDeploymentId: '70000000-0000-4000-8000-000000000002',
          connectionId: '70000000-0000-4000-8000-000000000003', protocol: 'openai_compatible',
          endpoint: 'https://growth.test/v1', model: 'extract-model', promptCode: `analysis.${code}_extract`,
          promptVersionId: '70000000-0000-4000-8000-000000000004',
          parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 },
        },
        {
          stepKey: 'synthesize', ordinal: 1, modelDeploymentId: '70000000-0000-4000-8000-000000000005',
          connectionId: '70000000-0000-4000-8000-000000000006', protocol: 'openai_compatible',
          endpoint: 'https://synthesize.test/v1', model: 'synthesize-model', promptCode: `analysis.${code}_synthesize`,
          promptVersionId: '70000000-0000-4000-8000-000000000007',
          parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
        },
      ],
    }
  }
  /**
   * 提取步骤返回原子结论，综合步骤记录程序去重结果并返回完整草稿。
   * @param _snapshot 已固定算法快照。
   * @param stepKey 当前固定步骤。
   * @param variables 当前步骤变量。
   * @param _responseSchemaName 当前响应结构名称。
   * @param _responseFormat 当前响应格式。
   * @param options 结构校验回调，用于模拟模型修正输出。
   * @returns 固定模型响应。
   */
  async executeStep(
    _snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    _responseSchemaName?: string,
    _responseFormat?: 'json_object' | 'text',
    options?: { validateStructuredOutput?: (value: unknown) => void },
  ): Promise<TextModelResponse> {
    if (stepKey === 'extract') {
      if (this.emptyExtraction) {
        return {
          structuredOutput: { facts: [] },
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        }
      }
      const input = (JSON.parse(variables.inputsJson) as Array<{ id: string, inputId?: string }>)[0]
      if (!input) throw new Error('成长提取测试缺少输入')
      const evidenceInputId = input.inputId ?? input.id
      let structuredOutput: unknown = { facts: [
        {
          statement: '优先保障稳定水运。',
          evidenceInputIds: [this.invalidEvidenceOnce ? '00000000-0000-4000-8000-000000000999' : evidenceInputId],
          confidence: 0.9,
        },
      ] }
      try {
        options?.validateStructuredOutput?.(structuredOutput)
      }
      catch {
        this.invalidEvidenceOnce = false
        structuredOutput = { facts: [{ statement: '优先保障稳定水运。', evidenceInputIds: [evidenceInputId], confidence: 0.9 }] }
        options?.validateStructuredOutput?.(structuredOutput)
      }
      return {
        structuredOutput,
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      }
    }
    this.synthesizeCallCount += 1
    this.synthesizedFacts = JSON.parse(variables.factsJson) as unknown[]
    return {
      structuredOutput: '进行城邦规划时，优先保障稳定水运。',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    }
  }
}

/** 模拟人物记忆专用算法，并记录综合步骤收到的程序校验后记忆事实。 */
class TwoStageMemoryAlgorithms {
  /** 记忆编译步骤收到的事实。 */
  public synthesizedFacts: unknown[] = []
  /** 记忆编译步骤实际调用次数。 */
  public synthesizeCallCount = 0

  /** @param conflicts 提取事实携带的未裁决冲突。 */
  constructor(private readonly conflicts: string[] = []) {}

  /** @param code 人物记忆算法编码。 @returns 固定两阶段配置快照。 */
  async prepare(code: 'persona_memory'): Promise<AiAlgorithmSnapshot> {
    return {
      algorithmCode: code,
      implementationVersion: 1,
      configurationVersionId: '71000000-0000-4000-8000-000000000001',
      configurationVersion: 1,
      steps: [
        {
          stepKey: 'extract', ordinal: 0, modelDeploymentId: '71000000-0000-4000-8000-000000000002',
          connectionId: '71000000-0000-4000-8000-000000000003', protocol: 'openai_compatible',
          endpoint: 'https://memory.test/v1', model: 'memory-extract-model', promptCode: 'analysis.persona_memory_extract',
          promptVersionId: '71000000-0000-4000-8000-000000000004',
          parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 },
        },
        {
          stepKey: 'synthesize', ordinal: 1, modelDeploymentId: '71000000-0000-4000-8000-000000000005',
          connectionId: '71000000-0000-4000-8000-000000000006', protocol: 'openai_compatible',
          endpoint: 'https://memory.test/v1', model: 'memory-synthesize-model', promptCode: 'analysis.persona_memory_synthesize',
          promptVersionId: '71000000-0000-4000-8000-000000000007',
          parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
        },
      ],
    }
  }

  /**
   * 提取步骤返回单条外部经验，综合步骤记录已通过门槛的事实并返回纯文本草稿。
   * @param _snapshot 已固定的人物记忆算法快照。
   * @param stepKey 当前固定步骤。
   * @param variables 当前提示词变量。
   * @returns 固定模型响应。
   */
  async executeStep(
    _snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
  ): Promise<TextModelResponse> {
    if (stepKey === 'extract') {
      const input = (JSON.parse(variables.inputsJson!) as Array<{ id: string, inputId?: string }>)[0]!
      // 模拟模型优先复制与输出字段同名的 inputId；输入中不应暴露容易误引的原资料 UUID。
      const evidenceInputId = input.inputId ?? input.id
      return {
        structuredOutput: { facts: [{
          statement: '完成过一次小说人物关系校对。',
          memoryType: 'experience',
          evidence: [{ inputId: evidenceInputId }],
          confidence: 0.9,
          conflicts: this.conflicts,
        }] },
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      }
    }
    this.synthesizeCallCount += 1
    this.synthesizedFacts = JSON.parse(variables.factsJson!) as unknown[]
    return {
      structuredOutput: '处理小说相关任务时，可参考其已完成过人物关系校对的经历。',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    }
  }
}

let directory: string
let database: SqliteDatabase
let analysis: AnalysisApplicationService
let learning: LearningApplicationService
let content: ContentApplicationService
let worker: WorkerApplicationService
let model: AnalysisTextModel
let worldId: string
let identifiers: SequentialIdentifierGenerator
let clock: TestClock
let contentRepository: SqliteContentRepository
let learningRepository: SqliteLearningRepository
let analysisRepository: SqliteAnalysisRepository
let prompts: AiPromptApplicationService

beforeEach(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-analysis-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  identifiers = new SequentialIdentifierGenerator()
  clock = new TestClock()
  const tokenCounter = new ConservativeTokenCounter()
  contentRepository = new SqliteContentRepository(database.getClient())
  learningRepository = new SqliteLearningRepository(database.getClient())
  const processor = new NodeSourceContentProcessor(identifiers)
  prompts = createTestAiPromptService(database, identifiers, clock)
  content = new ContentApplicationService({
    repository: contentRepository,
    souls: contentRepository,
    identifiers,
    clock,
    tokenCounter,
    tokenBudgets: { world: 2_500, persona: 3_500 },
    sourceProcessor: processor,
    sourceFiles: new LocalSourceFileStorage(directory),
    prompts,
  })
  const souls = new SoulApplicationService({
    content: contentRepository,
    souls: contentRepository,
    identifiers,
    clock,
    tokenCounter,
    tokenBudgets: { world: 2_500, persona: 3_500 },
    prompts,
  })
  analysisRepository = new SqliteAnalysisRepository(database.getClient())
  learning = new LearningApplicationService({
    content: contentRepository,
    learning: learningRepository,
    analysis: analysisRepository,
    identifiers,
    clock,
    tokenCounter,
    promptTokenBudgets: { world_growth: 2_500, persona_growth: 2_500, persona_memory: 3_000 },
  })
  model = new AnalysisTextModel()
  analysis = new AnalysisApplicationService({
    content: contentRepository,
    souls: contentRepository,
    learning: learningRepository,
    analysis: analysisRepository,
    model,
    prompts,
    identifiers,
    clock,
  })
  worker = new WorkerApplicationService({
    taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
    taskHandler: analysis,
    clock,
    leaseDurationMs: 60_000,
  })
  const world = await content.createWorld({
    name: '水城世界', summary: '', snapshot: { promptText: '城邦文明依赖河网。' }, changeSummary: '建立世界',
  })
  worldId = world.world.id
  await souls.publishDraft('world', worldId)
  const source = await content.createPastedSource({ name: '城邦资料', role: 'canon_fact', content: '主要城邦依水而建，运输依赖河道。' })
  await content.linkSource(source.source.id, { targetType: 'world', targetId: worldId, priority: 10 })
  await learning.importGrowthSources('world', worldId, { items: [{ sourceId: source.source.id, importance: 5 }] })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('AI 综合提炼学习提示词', () => {
  it('综合全部启用素材生成不生效草稿，保留评分并等待人工发布', async () => {
    const queued = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    expect(queued).toMatchObject({ status: 'queued', resultSummary: null, proposals: [] })
    expect((await learning.getWorldGrowthWorkspace(worldId)).prompt.activeVersion).toBeNull()

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const completed = await analysis.getBatch(queued.id)
    expect(completed).toMatchObject({
      status: 'completed', resultSummary: 'AI 已根据全部启用素材生成完整提示词草稿。', proposals: [],
      inputs: [expect.objectContaining({ inputType: 'growth_material', importance: 5 })],
    })
    expect(model.lastRequest?.userPrompt).toContain('"importance":5')
    expect(model.lastRequest).toMatchObject({ responseFormat: 'text', parameters: { temperature: 0.2 } })

    const workspace = await learning.getWorldGrowthWorkspace(worldId)
    expect(workspace.prompt).toMatchObject({
      activeVersion: null,
      draft: {
        promptText: '进行城邦规划时，优先保障稳定水运，并明确区分确定事实与推断。',
        sourceAnalysisBatchId: queued.id,
        createdBy: 'analysis',
      },
    })
  })

  it('配置成长算法后固定完整快照、校验证据并在综合前合并重复原子结论', async () => {
    const algorithms = new TwoStageGrowthAlgorithms()
    analysis = new AnalysisApplicationService({
      content: contentRepository,
      souls: contentRepository,
      learning: learningRepository,
      analysis: analysisRepository,
      model,
      prompts,
      identifiers,
      clock,
      algorithms,
    })
    worker = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
      taskHandler: analysis,
      clock,
      leaseDurationMs: 60_000,
    })

    const queued = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    const snapshot = database.getClient().prepare(`
      SELECT algorithm_snapshot_json FROM analysis_batches WHERE id = ?
    `).get(queued.id) as { algorithm_snapshot_json: string }
    expect(JSON.parse(snapshot.algorithm_snapshot_json)).toMatchObject({
      implementationVersion: 1, configurationVersion: 3,
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(algorithms.synthesizedFacts).toEqual([expect.objectContaining({
      statement: '优先保障稳定水运。', evidenceCount: 1, confidence: 0.9,
    })])
    expect((await learning.getWorldGrowthWorkspace(worldId)).prompt.draft).toMatchObject({
      promptText: '进行城邦规划时，优先保障稳定水运。',
      sourceAnalysisBatchId: queued.id,
    })
    expect(database.getClient().prepare(`
      SELECT extraction_result_json, validated_facts_json FROM analysis_batches WHERE id = ?
    `).get(queued.id)).toEqual({
      extraction_result_json: expect.stringContaining('优先保障稳定水运。'),
      validated_facts_json: expect.stringContaining('"evidenceCount":1'),
    })
  })

  it('成长结论首次引用批次外资料时由结构修正返回当前批次输入', async () => {
    const algorithms = new TwoStageGrowthAlgorithms()
    algorithms.invalidEvidenceOnce = true
    analysis = new AnalysisApplicationService({
      content: contentRepository,
      souls: contentRepository,
      learning: learningRepository,
      analysis: analysisRepository,
      model,
      prompts,
      identifiers,
      clock,
      algorithms,
    })
    worker = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
      taskHandler: analysis,
      clock,
      leaseDurationMs: 60_000,
    })
    const queued = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect((await analysis.getBatch(queued.id)).status).toBe('completed')
    expect(algorithms.synthesizedFacts).toEqual([expect.objectContaining({ evidenceCount: 1 })])
  })

  it('提取结果没有新事实时直接完成批次且不调用综合或创建草稿', async () => {
    const algorithms = new TwoStageGrowthAlgorithms(true)
    analysis = new AnalysisApplicationService({
      content: contentRepository,
      souls: contentRepository,
      learning: learningRepository,
      analysis: analysisRepository,
      model,
      prompts,
      identifiers,
      clock,
      algorithms,
    })
    worker = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
      taskHandler: analysis,
      clock,
      leaseDurationMs: 60_000,
    })

    const queued = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })

    expect(algorithms.synthesizeCallCount).toBe(0)
    expect(await analysis.getBatch(queued.id)).toMatchObject({
      status: 'completed',
      resultSummary: '没有形成新事实。',
    })
    expect((await learning.getWorldGrowthWorkspace(worldId)).prompt.draft).toBeNull()
    expect(database.getClient().prepare(`
      SELECT extraction_result_json, validated_facts_json FROM analysis_batches WHERE id = ?
    `).get(queued.id)).toEqual({
      extraction_result_json: '{"facts":[]}',
      validated_facts_json: '[]',
    })
  })

  it('增量提炼不会重复消费同正文同评分素材，完整重建仍可发起', async () => {
    await expect(learning.getWorldGrowthWorkspace(worldId)).resolves.toMatchObject({
      inputStatistics: { enabledCount: 1, pendingCount: 1 },
    })
    const first = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    await worker.executeNext()
    await expect(learning.getWorldGrowthWorkspace(worldId)).resolves.toMatchObject({
      inputStatistics: { enabledCount: 1, pendingCount: 0 },
    })
    await expect(analysis.createBatch('world_growth', worldId, { mode: 'incremental' }))
      .rejects.toMatchObject({ code: 'NO_NEW_ANALYSIS_INPUT', statusCode: 409 })

    const rebuild = await analysis.createBatch('world_growth', worldId, { mode: 'full_rebuild' })
    expect(rebuild).toMatchObject({ mode: 'full_rebuild', status: 'queued' })
    expect(rebuild.id).not.toBe(first.id)
  })

  it('同一对象已有排队中的提炼时拒绝重复创建批次', async () => {
    await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })

    await expect(analysis.createBatch('world_growth', worldId, { mode: 'incremental' }))
      .rejects.toMatchObject({ code: 'ANALYSIS_ALREADY_PENDING', statusCode: 409 })
  })

  it('任务记录可读取后台提炼批次及其状态', async () => {
    const queued = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })

    await expect(analysis.listBatches({ limit: 100 })).resolves.toEqual([
      expect.objectContaining({ id: queued.id, status: 'queued' }),
    ])
  })

  it('人工发布 AI 草稿后才形成当前提示词版本', async () => {
    const batch = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    await worker.executeNext()
    const published = await learning.publishLearningPromptDraft('world_growth', worldId, { changeSummary: '确认水运规划经验' })
    expect(published).toMatchObject({
      versionNo: 1,
      promptText: '进行城邦规划时，优先保障稳定水运，并明确区分确定事实与推断。',
      sourceAnalysisBatchId: batch.id,
      createdBy: 'analysis',
    })
    expect((await learning.getWorldGrowthWorkspace(worldId)).prompt).toMatchObject({
      activeVersion: { id: published.id }, draft: null,
    })
  })

  it('自动批次完成后直接发布当前版本且不保留草稿', async () => {
    analysis = new AnalysisApplicationService({
      content: contentRepository,
      souls: contentRepository,
      learning: learningRepository,
      analysis: analysisRepository,
      model,
      prompts,
      identifiers,
      clock,
      tokenCounter: new ConservativeTokenCounter(),
      promptTokenBudgets: { world_growth: 2_500, persona_growth: 2_500, persona_memory: 3_000 },
    })
    worker = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
      taskHandler: analysis,
      clock,
      leaseDurationMs: 60_000,
    })

    const batch = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' }, { autoPublish: true })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })

    expect((await learning.getWorldGrowthWorkspace(worldId)).prompt).toMatchObject({
      activeVersion: {
        sourceAnalysisBatchId: batch.id,
        createdBy: 'analysis',
        changeSummary: '系统定时提炼并自动发布',
      },
      draft: null,
    })
  })

  it('批次创建后当前学习提示词变化时拒绝覆盖新版本和草稿', async () => {
    await learning.saveLearningPromptDraft('world_growth', worldId, {
      promptText: '初始水运规则。', baseVersionId: null,
    })
    const initial = await learning.publishLearningPromptDraft('world_growth', worldId, { changeSummary: '建立初始规则' })
    const batch = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })

    await learning.saveLearningPromptDraft('world_growth', worldId, {
      promptText: '管理员刚发布的新规则。', baseVersionId: initial.id,
    })
    const current = await learning.publishLearningPromptDraft('world_growth', worldId, { changeSummary: '人工更新规则' })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })
    expect(await analysis.getBatch(batch.id)).toMatchObject({ status: 'failed', errorCode: 'VERSION_CONFLICT' })
    expect((await learning.getWorldGrowthWorkspace(worldId)).prompt).toMatchObject({
      activeVersion: { id: current.id, promptText: '管理员刚发布的新规则。' },
      draft: null,
    })
  })

  it('批次创建后出现人工草稿时拒绝覆盖该草稿', async () => {
    await learning.saveLearningPromptDraft('world_growth', worldId, {
      promptText: '初始水运规则。', baseVersionId: null,
    })
    const initial = await learning.publishLearningPromptDraft('world_growth', worldId, { changeSummary: '建立初始规则' })
    const batch = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    await learning.saveLearningPromptDraft('world_growth', worldId, {
      promptText: '尚未发布的人工草稿。', baseVersionId: initial.id,
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })
    expect(await analysis.getBatch(batch.id)).toMatchObject({ status: 'failed', errorCode: 'VERSION_CONFLICT' })
    expect((await learning.getWorldGrowthWorkspace(worldId)).prompt.draft).toMatchObject({
      promptText: '尚未发布的人工草稿。', createdBy: 'user',
    })
  })

  it('人物记忆专用算法会固定第三方记录，校验证据门槛后编译待发布草稿', async () => {
    const persona = await content.createPersona({
      name: '外部经历人物', worldId: null, sourceIds: [],
      snapshot: { promptText: '重视可追溯的工作经验。' }, changeSummary: '建立人物',
    })
    await learning.createExternalRecord(persona.persona.id, {
      occurredOn: '2026-08-31', content: '完成了一次小说人物关系校对。',
      references: [{ name: '校对笔记', address: '笔记库/小说/第三章' }], importance: 5,
    })
    await expect(learning.getPersonaMemoryWorkspace(persona.persona.id)).resolves.toMatchObject({
      inputStatistics: { enabledCount: 1, pendingCount: 1 },
    })

    const algorithms = new TwoStageMemoryAlgorithms()
    analysis = new AnalysisApplicationService({
      content: contentRepository,
      souls: contentRepository,
      learning: learningRepository,
      analysis: analysisRepository,
      model,
      prompts,
      identifiers,
      clock,
      algorithms,
    })
    worker = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
      taskHandler: analysis,
      clock,
      leaseDurationMs: 60_000,
    })

    const queued = await analysis.createBatch('persona_memory', persona.persona.id, { mode: 'incremental' })
    expect(queued.inputs).toEqual([expect.objectContaining({
      inputType: 'persona_external_record', title: '2026-08-31 第三方经历', importance: 5,
      contentSnapshot: expect.stringContaining('校对笔记：笔记库/小说/第三章'),
    })])
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(algorithms.synthesizedFacts).toEqual([expect.objectContaining({
      statement: '完成过一次小说人物关系校对。', memoryType: 'experience', independentEvidenceCount: 1,
    })])
    await expect(learning.getPersonaMemoryWorkspace(persona.persona.id)).resolves.toMatchObject({
      inputStatistics: { enabledCount: 1, pendingCount: 0 },
      prompt: { draft: { promptText: '处理小说相关任务时，可参考其已完成过人物关系校对的经历。' } },
    })
  })

  it('人物记忆事实仍有冲突时禁止自动综合发布', async () => {
    const persona = await content.createPersona({
      name: '冲突经历人物', worldId: null, sourceIds: [],
      snapshot: { promptText: '只使用已核对的经历。' }, changeSummary: '建立人物',
    })
    await learning.createExternalRecord(persona.persona.id, {
      occurredOn: '2026-09-01', content: '完成了一次人物关系校对。',
      references: [{ name: '待复核笔记', address: '笔记库/冲突记录' }], importance: 5,
    })
    const algorithms = new TwoStageMemoryAlgorithms(['经历来源仍有冲突'])
    analysis = new AnalysisApplicationService({
      content: contentRepository,
      souls: contentRepository,
      learning: learningRepository,
      analysis: analysisRepository,
      model,
      prompts,
      identifiers,
      clock,
      algorithms,
      tokenCounter: new ConservativeTokenCounter(),
      promptTokenBudgets: { world_growth: 2_500, persona_growth: 2_500, persona_memory: 3_000 },
    })
    worker = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
      taskHandler: analysis,
      clock,
      leaseDurationMs: 60_000,
    })

    const batch = await analysis.createBatch('persona_memory', persona.persona.id, { mode: 'incremental' }, { autoPublish: true })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })

    expect(algorithms.synthesizeCallCount).toBe(0)
    expect(await analysis.getBatch(batch.id)).toMatchObject({ status: 'failed', errorCode: 'ANALYSIS_FACT_CONFLICT' })
    expect((await learning.getPersonaMemoryWorkspace(persona.persona.id)).prompt).toMatchObject({
      activeVersion: null, draft: null,
    })
  })
})
