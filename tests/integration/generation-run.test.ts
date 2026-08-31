import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { SoulApplicationService } from '../../server/application/content/SoulApplicationService'
import { DEFAULT_TEXT_PARAMETERS, GenerationApplicationService } from '../../server/application/generation/GenerationApplicationService'
import { LearningApplicationService } from '../../server/application/learning/LearningApplicationService'
import { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { LocalImageAssetStorage } from '../../server/infrastructure/content/LocalImageAssetStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteContextProvider } from '../../server/infrastructure/context/SqliteContextProvider'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteRunRepository } from '../../server/infrastructure/database/SqliteRunRepository'
import { SqliteLearningRepository } from '../../server/infrastructure/database/SqliteLearningRepository'
import { SqliteAnalysisRepository } from '../../server/infrastructure/database/SqliteAnalysisRepository'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'
import { SystemIdentifierGenerator } from '../../server/infrastructure/system/SystemIdentifierGenerator'
import { ConservativeTokenCounter } from '../../server/infrastructure/model/ConservativeTokenCounter'
import type { Clock } from '../../server/ports/Clock'
import type { ImageModelPort, ImageModelRequest, ImageModelResponse } from '../../server/ports/ImageModelPort'
import { ImageModelError } from '../../server/ports/ImageModelPort'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import { TextModelError } from '../../server/ports/TextModelPort'
import type { PersonaSnapshot } from '../../shared/types/content'
import type { DocumentSpec } from '../../shared/schemas/generation'
import type { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { createTestAiPromptService } from '../support/createTestAiPromptService'
import { SystemAiSettingsApplicationService } from '../../server/application/systemAi/SystemAiSettingsApplicationService'
import { SqliteSystemAiSettingsRepository } from '../../server/infrastructure/database/SqliteSystemAiSettingsRepository'

/** 测试固定时钟。 */
class TestClock implements Clock {
  /** 当前测试时间。 */
  public timestamp = 1_000

  /** @returns 当前 UTC Unix 毫秒。 */
  now(): number { return this.timestamp++ }
}

/** 按结构名称返回确定结果的免费测试文本模型。 */
class FixedTextModel implements TextModelPort {
  /** 每类结构已调用次数。 */
  public readonly calls = new Map<string, number>()
  /** 最近一次各类结构请求，供提示边界断言。 */
  public readonly requests = new Map<string, TextModelRequest>()
  /** 是否让第一次兴趣输出故意无效。 */
  public invalidInterestOnce = false
  /** 是否持续返回无效兴趣结构。 */
  public invalidInterestAlways = false
  /** 是否让第一次人物草稿错误地包含创建流程元话术。 */
  public invalidPersonaMetaOnce = false
  /** 是否让第一次世界草稿错误地包含创建流程元话术。 */
  public invalidWorldMetaOnce = false
  /** 兴趣调用前还要模拟的限流次数。 */
  public interestRateLimitsRemaining = 0
  /** 每次成功响应返回的固定供应商用量。 */
  public usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
  /** 兴趣响应返回前执行的异步测试钩子。 */
  public afterInterestResponse: (() => Promise<void>) | null = null

  /** @returns 固定非敏感模型快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible' as const, model: 'fixed-test-model', endpointOrigin: 'https://model.test' }
  }

  /**
   * 根据调用要求返回兴趣、规格或块结构。
   * @param request 生成请求。
   * @returns 固定结构与用量。
   */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    const call = (this.calls.get(request.responseSchemaName) ?? 0) + 1
    this.calls.set(request.responseSchemaName, call)
    this.requests.set(request.responseSchemaName, request)
    if (request.responseSchemaName === 'persona_draft') {
      const result = {
        name: '林默',
        snapshot: {
          promptText: '谨慎的学院档案员；重视可核验事实；冷静简洁；资料不足时明确说明未知。',
        },
      }
      if (this.invalidPersonaMetaOnce && call === 1) result.snapshot.promptText = '该设定仅为待用户编辑确认的候选草稿，尚未发布。'
      return response(result, this.usage)
    }
    if (request.responseSchemaName === 'world_draft') {
      const result = {
        name: '浮岛纪元',
        summary: '浮空岛屿与风帆航路构成的架空世界。',
        snapshot: {
          promptText: '人类定居浮空岛屿，依靠风帆船与受季风约束的航路往来。',
        },
      }
      if (this.invalidWorldMetaOnce && call === 1) result.snapshot.promptText = '该设定仅为候选草稿，尚未发布，也不代表已影响任何人物。'
      return response(result, this.usage)
    }
    if (request.responseSchemaName === 'interest_assessment') {
      if (this.interestRateLimitsRemaining > 0) {
        this.interestRateLimitsRemaining -= 1
        throw new TextModelError('PROVIDER_RATE_LIMITED', '测试限流', true)
      }
      if (this.invalidInterestAlways || (this.invalidInterestOnce && call === 1)) return response({ decision: 'invalid' }, this.usage)
      const evidence = readEvidence(request.userPrompt)
      const fact = evidence.find(item => item.role === 'canon_fact')
      const result = response({
        probability: 0.88,
        confidence: 0.82,
        decision: 'interested',
        factors: [{ dimension: 'topic', score: 0.9, explanation: '符合人物兴趣。' }],
        supportingEvidenceIds: fact ? [fact.id] : [],
        opposingEvidenceIds: [],
        unknowns: [],
        reasoningSummary: '人物偏好与内容主题一致。',
      }, this.usage)
      if (this.afterInterestResponse) await this.afterInterestResponse()
      return result
    }
    if (request.responseSchemaName === 'document_spec') {
      return response({
        title: '学院观察',
        summary: '以人物口吻介绍学院。',
        blocks: [
          { key: 'title', role: 'heading', instruction: '写标题', acceptanceCriteria: ['简短'], dependsOn: [] },
          { key: 'body', role: 'paragraph', instruction: '写正文', acceptanceCriteria: ['符合人物风格'], dependsOn: ['title'] },
        ],
      }, this.usage)
    }
    const currentBlockInstruction = request.userPrompt.match(/<当前块任务>(.*?)<\/当前块任务>/s)?.[1]
    return response({ text: currentBlockInstruction === '"写标题"' ? '学院观察' : '这里的课程值得认真研究。' }, this.usage)
  }
}

/** 明确关闭能力的测试模型。 */
class DisabledTextModel extends FixedTextModel {
  /** @returns 始终返回 null。 */
  override getConfiguredModel(): null { return null }
}

/** 返回固定 PNG 或稳定失败的免费测试图片模型。 */
class FixedImageModel implements ImageModelPort {
  /** 图片调用次数。 */
  public calls = 0
  /** 是否让后续调用稳定失败。 */
  public shouldFail = false
  /** 最近一次视觉请求。 */
  public lastRequest: ImageModelRequest | null = null

  /** @returns 固定非敏感图片模型快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible_images' as const, model: 'fixed-image-model', endpointOrigin: 'https://image.test' }
  }

  /** @param request 图片请求。 @returns 固定 PNG；失败开关开启时抛出不可重试错误。 */
  async generate(request: ImageModelRequest): Promise<ImageModelResponse> {
    this.calls += 1
    this.lastRequest = request
    if (this.shouldFail) throw new ImageModelError('IMAGE_OUTPUT_INVALID', '测试图片无效', false)
    return { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), declaredMediaType: 'image/png' }
  }
}

/** 明确关闭图片能力的测试模型。 */
class DisabledImageModel extends FixedImageModel {
  /** @returns 始终返回 null。 */
  override getConfiguredModel(): null { return null }
}

/** @param structuredOutput 固定结构。 @param usage 固定供应商用量。 @returns 统一模型响应。 */
function response(structuredOutput: unknown, usage: TextModelResponse['usage']): TextModelResponse {
  return { structuredOutput, usage }
}

/** @param prompt 分层用户提示。 @returns 提示中的证据简表。 */
function readEvidence(prompt: string): Array<{ id: string, role: string }> {
  const match = /<不可信参考资料>(.*?)<\/不可信参考资料>/s.exec(prompt)
  return match ? JSON.parse(match[1]!) as Array<{ id: string, role: string }> : []
}

const PERSONA_SNAPSHOT: PersonaSnapshot = {
  promptText: '热爱知识的学院观察员；重视求证；冷静简洁；资料不足时说明未知。',
}

let directory: string
let database: SqliteDatabase
let contentService: ContentApplicationService
let learningService: LearningApplicationService
let generation: GenerationApplicationService
let worker: WorkerApplicationService
let model: FixedTextModel
let imageModel: FixedImageModel
let imageAssets: LocalImageAssetStorage
let personaId: string
let sourceId: string
let testClock: TestClock
/** 使用真实迁移模板的测试提示词目录。 */
let aiPrompts: AiPromptApplicationService
/** 测试运行实际读取的系统 AI 分场景参数。 */
let systemAiSettings: SystemAiSettingsApplicationService

beforeEach(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-generation-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  const identifiers = new SystemIdentifierGenerator()
  testClock = new TestClock()
  aiPrompts = createTestAiPromptService(database, identifiers, testClock)
  const contentRepository = new SqliteContentRepository(database.getClient())
  const learningRepository = new SqliteLearningRepository(database.getClient())
  const processor = new NodeSourceContentProcessor(identifiers)
  const tokenCounter = new ConservativeTokenCounter()
  imageAssets = new LocalImageAssetStorage(directory)
  contentService = new ContentApplicationService({
    repository: contentRepository, souls: contentRepository, identifiers, clock: testClock,
    tokenCounter, tokenBudgets: { world: 2_500, persona: 3_500 }, sourceProcessor: processor,
    sourceFiles: new LocalSourceFileStorage(directory), imageAssets,
    prompts: aiPrompts,
  })
  const source = await contentService.createPastedSource({
    name: '学院原著事实', role: 'canon_fact', content: '魔法学院课程包含古代文献研究与档案整理。',
  })
  sourceId = source.source.id
  const persona = await contentService.createPersona({
    name: '林默', worldId: null, sourceIds: [source.source.id],
    snapshot: PERSONA_SNAPSHOT, changeSummary: '建立人物',
  })
  await new SoulApplicationService({
    content: contentRepository,
    souls: contentRepository,
    identifiers,
    clock: testClock,
    tokenCounter: new ConservativeTokenCounter(),
    prompts: aiPrompts,
    tokenBudgets: { world: 2_500, persona: 3_500 },
  }).publishDraft('persona', persona.persona.id)
  personaId = persona.persona.id
  learningService = new LearningApplicationService({
    content: contentRepository,
    learning: learningRepository,
    analysis: new SqliteAnalysisRepository(database.getClient()),
    identifiers,
    clock: testClock,
    tokenCounter,
    promptTokenBudgets: { world_growth: 2_500, persona_growth: 2_500, persona_memory: 3_000 },
  })
  model = new FixedTextModel()
  imageModel = new FixedImageModel()
  systemAiSettings = new SystemAiSettingsApplicationService({
    repository: new SqliteSystemAiSettingsRepository(database.getClient()),
    clock: testClock,
  })
  generation = new GenerationApplicationService({
    runs: new SqliteRunRepository(database.getClient()), content: contentRepository,
    context: new SqliteContextProvider(database.getClient()), model, prompts: aiPrompts, imageModel, imageAssets,
    identifiers, clock: testClock, sourceProcessor: processor,
    tokenCounter: new ConservativeTokenCounter(), learning: learningRepository,
    systemAiSettings,
  })
  worker = new WorkerApplicationService({
    taskJobRepository: new SqliteTaskJobRepository(database.getClient()), taskHandler: generation,
    clock: testClock, leaseDurationMs: 60_000,
  })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('阶段三纯文本运行', () => {
  it('从自然语言和选定资料生成不落库的结构化人物候选草稿', async () => {
    const before = database.getClient().prepare('SELECT COUNT(*) AS count FROM personas').get()
    model.invalidPersonaMetaOnce = true
    const draft = await generation.generatePersonaDraft({
      prompt: '创建一名谨慎的学院档案员，回答必须简短。',
      worldId: null,
      sourceIds: [sourceId, sourceId],
    })

    expect(draft).toMatchObject({
      name: '林默',
      snapshot: { promptText: expect.stringContaining('谨慎的学院档案员') },
      warnings: [],
    })
    const request = model.requests.get('persona_draft')!
    expect(request.userPrompt).toContain('创建一名谨慎的学院档案员')
    expect(request.userPrompt).toContain('魔法学院课程包含古代文献研究与档案整理。')
    expect(request.userPrompt).not.toContain('人物来源模式')
    expect(request.userPrompt.match(/学院原著事实/g)).toHaveLength(1)
    expect(request.systemPrompt).toContain('原著事实只能来自 role=canon_fact')
    expect(request.systemPrompt).toContain('禁止写入返回内容')
    expect(model.calls.get('persona_draft')).toBe(2)
    expect(JSON.stringify(draft)).not.toContain('候选草稿')
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM personas').get()).toEqual(before)
  })

  it('从自然语言生成不落库的结构化世界候选草稿', async () => {
    const before = database.getClient().prepare('SELECT COUNT(*) AS count FROM worlds').get()
    const settings = await systemAiSettings.getSettings()
    settings.values.draftGeneration.temperature = 0.8
    await systemAiSettings.updateSettings(settings.values)
    model.invalidWorldMetaOnce = true
    const draft = await generation.generateWorldDraft({ prompt: '创建一个人类生活在浮空岛屿、依靠风帆船往来的世界。' })

    expect(draft).toMatchObject({
      name: '浮岛纪元',
      summary: expect.stringContaining('浮空岛屿'),
      snapshot: { promptText: expect.stringContaining('季风') },
    })
    const request = model.requests.get('world_draft')!
    expect(request.userPrompt).toContain('人类生活在浮空岛屿')
    expect(request.systemPrompt).toContain('字段必须为 name、summary 和 snapshot')
    expect(request.systemPrompt).toContain('promptText 是实际进入人物任务提示词')
    expect(request.systemPrompt).toContain('禁止写入返回内容')
    expect(model.calls.get('world_draft')).toBe(2)
    expect(model.requests.get('world_draft')?.parameters.temperature).toBe(0.8)
    expect(JSON.stringify(draft)).not.toContain('候选草稿')
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM worlds').get()).toEqual(before)
  })

  it('保存固定输入与证据快照并完成结构化兴趣判断', async () => {
    await learningService.saveLearningPromptDraft('persona_growth', personaId, {
      promptText: '回答时先给简洁结论。', baseVersionId: null,
    })
    await learningService.publishLearningPromptDraft('persona_growth', personaId, { changeSummary: '建立成长提示词' })
    await learningService.saveLearningPromptDraft('persona_memory', personaId, {
      promptText: '过去处理事实内容时会优先核验依据。', baseVersionId: null,
    })
    await learningService.publishLearningPromptDraft('persona_memory', personaId, { changeSummary: '建立记忆提示词' })
    model.invalidInterestOnce = true
    const created = await generation.createInterestRun({
      personaId,
      content: '魔法学院课程是否值得参加？',
      scene: { ageStage: '', location: '图书馆', currentGoal: '', emotion: '', event: '' },
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const details = await generation.getRun(created.runId)
    expect(details.run).toMatchObject({
      status: 'succeeded',
      result: { decision: 'interested', probability: 0.88, confidence: 0.82 },
      scene: { location: '图书馆' },
      promptVersion: expect.stringMatching(/^ai-catalog:[0-9a-f]{16}$/),
      contextProvider: 'sqlite_fts5',
      promptContext: {
        aiPromptVersions: {
          'generation.interest_assessment': expect.any(String),
          'generation.json_retry': expect.any(String),
        },
        tokenCountExact: false,
        personaSoulVersionId: details.run.personaVersionId,
        selected: [
          expect.objectContaining({ category: 'persona_growth', role: 'growth', skippedReason: null }),
          expect.objectContaining({ category: 'persona_memory', role: 'memory', skippedReason: null }),
          expect.objectContaining({ category: 'source', role: 'canon_fact', skippedReason: null }),
        ],
        skipped: [],
      },
    })
    expect(details.evidence.map(item => item.role)).toEqual(['user_setting', 'growth', 'memory', 'canon_fact'])
    expect(details.evidence[1]?.metadata).toMatchObject({ fixedLearningPrompt: true, learningPromptType: 'persona_growth' })
    expect(details.evidence[2]?.metadata).toMatchObject({ fixedLearningPrompt: true, learningPromptType: 'persona_memory' })
    expect(details.run.result?.supportingEvidenceIds).toEqual([details.evidence[3]!.id])
    expect(model.requests.get('interest_assessment')?.userPrompt).toContain('<当前人物成长提示词>"回答时先给简洁结论。"</当前人物成长提示词>')
    expect(model.requests.get('interest_assessment')?.userPrompt).toContain('<当前人物记忆提示词>"过去处理事实内容时会优先核验依据。"</当前人物记忆提示词>')
    expect(model.calls.get('interest_assessment')).toBe(2)
    expect(details.run.usage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })
    expect(database.getClient().prepare(`
      SELECT persona_id, run_id, operation_type, is_enabled FROM persona_operation_records WHERE run_id = ?
    `).get(created.runId)).toEqual({
      persona_id: personaId, run_id: created.runId, operation_type: 'interest_assessment', is_enabled: 1,
    })
  })

  it('禁用人物后拒绝创建新任务且不影响既有人物数据', async () => {
    await contentService.updatePersonaStatus(personaId, { isEnabled: false })

    await expect(generation.createInterestRun({
      personaId, content: '禁用后不应创建任务',
    })).rejects.toMatchObject({ code: 'RESOURCE_DISABLED', statusCode: 409 })
    await expect(contentService.getPersona(personaId)).resolves.toMatchObject({
      persona: { id: personaId, isEnabled: false, activeVersionId: expect.any(String) },
      sources: [expect.objectContaining({ id: sourceId })],
    })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM generation_runs').get()).toEqual({ count: 0 })
  })

  it('禁用世界后关联人物仍可创建任务但新任务不再使用该世界', async () => {
    const world = await contentService.createWorld({
      name: '暂时停用的世界', summary: '',
      snapshot: {
        promptText: '所有课程必须在浮岛进行。',
      },
      changeSummary: '建立世界',
    })
    const repository = new SqliteContentRepository(database.getClient())
    await new SoulApplicationService({
      content: repository, souls: repository, identifiers: new SystemIdentifierGenerator(), clock: testClock,
      tokenCounter: new ConservativeTokenCounter(), tokenBudgets: { world: 2_500, persona: 3_500 },
      prompts: aiPrompts,
    }).publishDraft('world', world.world.id)
    await contentService.updatePersona(personaId, { name: '林默', worldId: world.world.id })
    await contentService.updateWorldStatus(world.world.id, { isEnabled: false })

    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    const details = await generation.getRun(created.runId)

    expect(details.run.promptContext).toMatchObject({
      worldSoulVersionId: null,
      budgets: { world: { soulUsed: 0, growthUsed: 0 } },
    })
    expect(details.evidence.some(item => typeof item.metadata.worldVersionId === 'string')).toBe(false)
  })

  it('兴趣分析忽略图文生成设置并保存独立系统参数快照', async () => {
    const profile = await generation.createParameterProfile({
      name: '极小提示上限',
      values: { ...DEFAULT_TEXT_PARAMETERS, maxPromptCharacters: 1_000 },
    })
    const settings = await systemAiSettings.getSettings()
    settings.values.interestAnalysis.temperature = 0.1
    await systemAiSettings.updateSettings(settings.values)
    const created = await generation.createInterestRun({ personaId, content: '长内容'.repeat(500) })

    const details = await generation.getRun(created.runId)
    expect(profile.values.maxPromptCharacters).toBe(1_000)
    expect(details.run.parameters).toMatchObject({ temperature: 0.1, maxPromptCharacters: 120_000 })
    expect(database.getClient().prepare('SELECT parameter_profile_id FROM generation_runs WHERE id = ?').get(created.runId))
      .toEqual({ parameter_profile_id: null })
  })

  it('兴趣分析不会继承图文生成设置的总 Token 上限', async () => {
    const profile = await generation.createParameterProfile({
      name: '小型 Token 预算',
      values: { ...DEFAULT_TEXT_PARAMETERS, maxTotalTokens: 64 },
    })
    model.usage = { inputTokens: 70, outputTokens: 30, totalTokens: 100 }
    const created = await generation.createInterestRun({ personaId, content: '学院课程' })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const completed = await generation.getRun(created.runId)
    expect(profile.values.maxTotalTokens).toBe(64)
    expect(completed.run).toMatchObject({
      status: 'succeeded', errorCode: null, parameters: { maxTotalTokens: 50_000 },
      usage: { inputTokens: 70, outputTokens: 30, totalTokens: 100 },
    })
  })

  it('规划规格后必须确认，确认后串行生成并保存独立块尝试', async () => {
    const created = await generation.createGenerationRun({
      personaId,
      requirement: '用人物风格介绍魔法学院课程。',
      scene: undefined,
      parameterProfileId: null,
      formatTemplateId: null,
    })
    await worker.executeNext()
    const planned = await generation.getRun(created.runId)
    expect(planned.run.status).toBe('awaiting_confirmation')
    expect(planned.documentSpecs).toHaveLength(1)
    expect(planned.blocks).toEqual([])
    expect(await worker.executeNext()).toMatchObject({ handled: false })

    await generation.confirmDocumentSpec(created.runId)
    await worker.executeNext()
    const completed = await generation.getRun(created.runId)
    expect(completed.run.status).toBe('succeeded')
    expect(completed.blocks.map(block => block.attempts[0]?.outputText)).toEqual([
      '学院观察',
      '这里的课程值得认真研究。',
    ])
    expect(completed.blocks.every(block => block.selectedAttemptId === block.attempts[0]?.id)).toBe(true)
    expect(completed.blocks.map(block => block.attempts[0]?.usage?.totalTokens)).toEqual([15, 15])
    expect(completed.run.usage).toEqual({ inputTokens: 30, outputTokens: 15, totalTokens: 45 })
  })

  it('排队运行可协作取消且不会再被 Worker 领取', async () => {
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    await generation.cancelRun(created.runId)
    expect((await generation.getRun(created.runId)).run.status).toBe('canceled')
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: false })
  })

  it('供应商响应后收到取消请求时保留已经产生的用量', async () => {
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    model.afterInterestResponse = async () => { await generation.cancelRun(created.runId) }

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    await expect(generation.getRun(created.runId)).resolves.toMatchObject({
      run: { status: 'canceled', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    })
  })

  it('进程退出后将已请求取消且租约过期的任务恢复为已取消', async () => {
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    const repository = new SqliteTaskJobRepository(database.getClient())
    await repository.claimNext(2_000, 10)
    database.getClient().prepare(`UPDATE generation_runs SET status = 'running' WHERE id = ?`).run(created.runId)
    await generation.cancelRun(created.runId)

    await expect(repository.recoverExpired(2_011)).resolves.toBe(1)
    const canceled = await generation.getRun(created.runId)
    expect(canceled.run.status).toBe('canceled')
    expect(canceled.tasks[0]?.status).toBe('canceled')
  })

  it('最后一次任务租约过期时同步终止运行并写入稳定错误', async () => {
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    database.getClient().prepare(`
      UPDATE task_jobs SET status = 'running', attempt_count = max_attempts, lease_until = 2_000
      WHERE id = ?
    `).run(created.taskId)
    database.getClient().prepare(`UPDATE generation_runs SET status = 'running' WHERE id = ?`).run(created.runId)

    const repository = new SqliteTaskJobRepository(database.getClient())
    await expect(repository.recoverExpired(2_001)).resolves.toBe(1)
    const failed = await generation.getRun(created.runId)
    expect(failed.run).toMatchObject({
      status: 'failed', errorCode: 'TASK_LEASE_EXHAUSTED', errorMessage: '任务执行中断且已达到最大尝试次数',
    })
    expect(failed.tasks[0]?.status).toBe('failed')
  })

  it('文本模型未配置时拒绝创建运行且不留下任务', async () => {
    const disabled = new GenerationApplicationService({
      runs: new SqliteRunRepository(database.getClient()),
      content: new SqliteContentRepository(database.getClient()),
      context: new SqliteContextProvider(database.getClient()),
      model: new DisabledTextModel(),
      prompts: aiPrompts,
      imageModel: new DisabledImageModel(),
      imageAssets,
      identifiers: new SystemIdentifierGenerator(),
      clock: new TestClock(),
      sourceProcessor: new NodeSourceContentProcessor(new SystemIdentifierGenerator()),
      tokenCounter: new ConservativeTokenCounter(),
      learning: new SqliteLearningRepository(database.getClient()),
    })
    await expect(disabled.createInterestRun({ personaId, content: '测试' })).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await expect(disabled.generatePersonaDraft({ prompt: '测试人物', sourceIds: [] }))
      .rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await expect(disabled.generateWorldDraft({ prompt: '测试世界' }))
      .rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM generation_runs').get()).toEqual({ count: 0 })
  })

  it('临时限流先自动重新排队并在第二次任务尝试成功', async () => {
    model.interestRateLimitsRemaining = 2
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })

    await expect(worker.executeNext()).resolves.toMatchObject({ succeeded: false })
    const waiting = await generation.getRun(created.runId)
    expect(waiting.run.status).toBe('queued')
    expect(waiting.tasks[0]).toMatchObject({ status: 'queued', attemptCount: 1, lastError: 'PROVIDER_RATE_LIMITED：测试限流' })

    await expect(worker.executeNext()).resolves.toMatchObject({ succeeded: true })
    const completed = await generation.getRun(created.runId)
    expect(completed.run.status).toBe('succeeded')
    expect(completed.tasks).toHaveLength(1)
    expect(completed.tasks[0]).toMatchObject({ status: 'succeeded', attemptCount: 2 })
  })

  it('结构错误耗尽后稳定失败，手工重试新增任务且保留旧历史', async () => {
    model.invalidInterestAlways = true
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })

    await worker.executeNext()
    await worker.executeNext()
    const failed = await generation.getRun(created.runId)
    expect(failed.run).toMatchObject({
      status: 'failed', errorCode: 'MODEL_OUTPUT_INVALID',
      usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
    })
    expect(failed.tasks[0]).toMatchObject({ status: 'failed', attemptCount: 2 })

    model.invalidInterestAlways = false
    const retried = await generation.retryRun(created.runId)
    expect(retried.taskId).not.toBe(created.taskId)
    await worker.executeNext()
    const completed = await generation.getRun(created.runId)
    expect(completed.run.usage).toEqual({ inputTokens: 50, outputTokens: 25, totalTokens: 75 })
    expect(completed.run.status).toBe('succeeded')
    expect(completed.tasks.map(task => task.status).sort()).toEqual(['failed', 'succeeded'])
  })

  it('租约过期后恢复中断块，保留失败尝试并继续后续块', async () => {
    const created = await generation.createGenerationRun({ personaId, requirement: '介绍课程' })
    await worker.executeNext()
    await generation.confirmDocumentSpec(created.runId)
    const planned = await generation.getRun(created.runId)
    const firstBlock = planned.blocks[0]!
    const repository = new SqliteTaskJobRepository(database.getClient())
    const claimed = await repository.claimNext(2_000, 10)
    expect(claimed?.type).toBe('execute_document')
    database.getClient().prepare(`UPDATE generation_runs SET status = 'running' WHERE id = ?`).run(created.runId)
    database.getClient().prepare(`UPDATE artifact_blocks SET status = 'running' WHERE id = ?`).run(firstBlock.id)
    database.getClient().prepare(`
      INSERT INTO block_attempts (id, block_id, attempt_no, status, input_snapshot_json, created_at)
      VALUES ('00000000-0000-4000-8000-000000000001', ?, 1, 'running', '{}', 2000)
    `).run(firstBlock.id)

    await expect(repository.recoverExpired(2_011)).resolves.toBe(1)
    expect((await generation.getRun(created.runId)).run.status).toBe('queued')
    await worker.executeNext()
    const completed = await generation.getRun(created.runId)
    expect(completed.run.status).toBe('succeeded')
    expect(completed.blocks[0]?.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptNo: 1, status: 'failed', errorCode: 'TASK_INTERRUPTED' }),
      expect.objectContaining({ attemptNo: 2, status: 'succeeded' }),
    ]))
  })

  it('人物删除影响列出并级联删除运行历史，但保留共享资料', async () => {
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    await worker.executeNext()
    const generated = await generation.createGenerationRun({ personaId, requirement: '介绍魔法学院课程' })
    await worker.executeNext()
    await generation.confirmDocumentSpec(generated.runId)
    await worker.executeNext()

    await expect(contentService.getPersonaDeletionImpact(personaId)).resolves.toMatchObject({
      runHistory: { runs: 2, tasks: 3, evidenceSnapshots: 4, documentSpecs: 1, artifactBlocks: 2, blockAttempts: 2 },
    })
    await contentService.deletePersona(personaId)
    await expect(generation.getRun(created.runId)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(generation.getRun(generated.runId)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(contentService.getSource(sourceId)).resolves.toMatchObject({ source: { id: sourceId } })
  })
})

/** @param dependency 图片是否依赖标题。 @returns 阶段四固定图文规格。 */
function mixedDocumentSpec(dependency = true): DocumentSpec {
  return {
    title: '学院观察',
    summary: '图文介绍学院。',
    purpose: '介绍课程',
    constraints: ['不虚构资料事实'],
    requestedFormats: ['html', 'markdown', 'txt'],
    blocks: [
      { key: 'title', type: 'text', role: 'heading', instruction: '写标题', acceptanceCriteria: ['简短'], dependsOn: [] },
      {
        key: 'hero', type: 'image', role: 'hero_image', instruction: '生成学院主图', acceptanceCriteria: ['清晰'], dependsOn: dependency ? ['title'] : [],
        visualBrief: {
          theme: '魔法学院', subject: '古代文献图书馆', composition: '横向居中构图', colorPalette: '深蓝与暖金',
          texture: '纸张与木材', aspectRatio: '16:9', altText: '魔法学院古代文献图书馆', negativePrompt: '文字、水印',
        },
      },
      { key: 'body', type: 'text', role: 'paragraph', instruction: '写正文', acceptanceCriteria: ['符合人物风格'], dependsOn: ['title'] },
    ],
  }
}

/** @param spec 待确认图文规格。 @returns 完成规划、修订、确认和执行后的运行标识。 */
async function executeMixedRun(spec: DocumentSpec = mixedDocumentSpec()): Promise<string> {
  const created = await generation.createGenerationRun({ personaId, requirement: '图文介绍学院课程', includeImages: true })
  await worker.executeNext()
  await generation.reviseDocumentSpec(created.runId, spec)
  await generation.confirmDocumentSpec(created.runId)
  await worker.executeNext()
  return created.runId
}

describe('阶段四图文块与导出', () => {
  it('文档规格分别执行文字块与图片块数量上限', async () => {
    const profile = await generation.createParameterProfile({
      name: '两文一图',
      values: { ...DEFAULT_TEXT_PARAMETERS, maxTextBlocks: 2, maxImageBlocks: 1 },
    })
    const created = await generation.createGenerationRun({
      personaId, requirement: '生成一文一图', includeImages: true, parameterProfileId: profile.id,
    })
    await worker.executeNext()
    const withinLimit = mixedDocumentSpec()
    await expect(generation.reviseDocumentSpec(created.runId, withinLimit)).resolves.toMatchObject({ revision: 2 })

    const tooManyTexts = mixedDocumentSpec()
    tooManyTexts.blocks.push({
      key: 'ending', type: 'text', role: 'paragraph', instruction: '写结尾', acceptanceCriteria: ['简短'], dependsOn: ['body'],
    })
    await expect(generation.reviseDocumentSpec(created.runId, tooManyTexts))
      .rejects.toMatchObject({ code: 'TASK_LIMIT_EXCEEDED', message: '文字块数量超过运行上限' })
    const tooManyImages = mixedDocumentSpec()
    tooManyImages.blocks = [
      tooManyImages.blocks[0]!,
      tooManyImages.blocks[1]!,
      { ...tooManyImages.blocks[1]!, key: 'illustration_2', dependsOn: ['title'] },
    ]
    await expect(generation.reviseDocumentSpec(created.runId, tooManyImages))
      .rejects.toMatchObject({ code: 'TASK_LIMIT_EXCEEDED', message: '图片块数量超过运行上限' })
  })

  it('图片模型未配置时拒绝图片运行但不影响纯文本运行', async () => {
    const identifiers = new SystemIdentifierGenerator()
    const disabled = new GenerationApplicationService({
      runs: new SqliteRunRepository(database.getClient()),
      content: new SqliteContentRepository(database.getClient()),
      context: new SqliteContextProvider(database.getClient()),
      model,
      prompts: aiPrompts,
      imageModel: new DisabledImageModel(),
      imageAssets,
      identifiers,
      clock: testClock,
      sourceProcessor: new NodeSourceContentProcessor(identifiers),
      tokenCounter: new ConservativeTokenCounter(),
      learning: new SqliteLearningRepository(database.getClient()),
    })

    await expect(disabled.createGenerationRun({ personaId, requirement: '生成图文', includeImages: true }))
      .rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await expect(disabled.createGenerationRun({ personaId, requirement: '仅生成文字', includeImages: false }))
      .resolves.toMatchObject({ status: 'planning' })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM generation_runs').get()).toEqual({ count: 1 })
  })

  it('生成固定 PNG 并从同一组选中尝试渲染及导出三种格式', async () => {
    const runId = await executeMixedRun()
    const details = await generation.getRun(runId)
    const imageBlock = details.blocks.find(block => block.type === 'image')!
    const asset = imageBlock.attempts[0]!.asset!

    expect(details.run).toMatchObject({ status: 'succeeded', input: { includeImages: true }, imageModel: { model: 'fixed-image-model' } })
    expect(imageModel.calls).toBe(1)
    expect(imageModel.lastRequest).toMatchObject({ aspectRatio: '16:9' })
    expect(imageModel.lastRequest?.prompt).toContain('古代文献图书馆')
    expect(existsSync(resolve(directory, 'artifacts', runId, asset.relativePath))).toBe(true)
    await expect(generation.getImageAsset(runId, asset.id)).resolves.toMatchObject({ mediaType: 'image/png' })

    const rendered = await generation.renderRun(runId, ['html', 'markdown', 'txt'])
    expect(rendered.assets).toEqual([expect.objectContaining({ id: asset.id, relativePath: asset.relativePath })])
    expect(rendered.documents.html).toContain('学院观察')
    expect(rendered.documents.markdown).toContain('学院观察')
    expect(rendered.documents.txt).toContain('学院观察')
    for (const format of ['html', 'markdown', 'txt'] as const) {
      const exported = await generation.exportRun(runId, format)
      expect(exported).toMatchObject({ fileName: expect.stringMatching(/\.zip$/), mediaType: 'application/zip' })
      const names = Object.keys(unzipSync(exported.bytes))
      expect(names).toContain(`document.${format === 'markdown' ? 'md' : format}`)
      expect(names).toContain(asset.relativePath)
      expect(names).toContain('manifest.json')
    }
  })

  it('图片失败时保留成功文字并标记部分成功，整文重试跳过锁定成功块', async () => {
    imageModel.shouldFail = true
    const runId = await executeMixedRun()
    const partial = await generation.getRun(runId)
    const imageBlock = partial.blocks.find(block => block.type === 'image')!
    const lockedText = partial.blocks.find(block => block.specKey === 'title')!
    const textCalls = model.calls.get('text_block')

    expect(partial.run.status).toBe('partial')
    expect(imageBlock.attempts).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'IMAGE_OUTPUT_INVALID' })])
    expect(partial.blocks.filter(block => block.type === 'text').every(block => block.status === 'succeeded')).toBe(true)
    await generation.setBlockLock(runId, lockedText.id, true)

    imageModel.shouldFail = false
    await generation.retryRun(runId)
    await worker.executeNext()
    const recovered = await generation.getRun(runId)
    expect(recovered.run.status).toBe('succeeded')
    expect(recovered.blocks.find(block => block.id === lockedText.id)).toMatchObject({ isLocked: true, selectedAttemptId: lockedText.selectedAttemptId })
    expect(model.calls.get('text_block')).toBe(textCalls)
    expect(recovered.blocks.find(block => block.id === imageBlock.id)?.attempts).toHaveLength(2)
  })

  it('单块重试追加尝试，允许选择历史成功尝试且锁定后禁止重试', async () => {
    const runId = await executeMixedRun()
    const initial = await generation.getRun(runId)
    const imageBlock = initial.blocks.find(block => block.type === 'image')!
    const firstAttempt = imageBlock.attempts[0]!

    await generation.retryBlock(runId, imageBlock.id)
    await expect(generation.selectBlockAttempt(runId, imageBlock.id, firstAttempt.id))
      .rejects.toMatchObject({ code: 'BLOCK_ATTEMPT_NOT_SELECTABLE' })
    await worker.executeNext()
    const retried = await generation.getRun(runId)
    const updatedImage = retried.blocks.find(block => block.id === imageBlock.id)!
    expect(updatedImage.attempts).toHaveLength(2)
    expect(updatedImage.selectedAttemptId).not.toBe(firstAttempt.id)

    const selected = await generation.selectBlockAttempt(runId, imageBlock.id, firstAttempt.id)
    expect(selected.blocks.find(block => block.id === imageBlock.id)?.selectedAttemptId).toBe(firstAttempt.id)
    const locked = await generation.setBlockLock(runId, imageBlock.id, true)
    expect(locked.blocks.find(block => block.id === imageBlock.id)).toMatchObject({ isLocked: true, lockedAt: expect.any(Number) })
    await expect(generation.retryBlock(runId, imageBlock.id)).rejects.toMatchObject({ code: 'BLOCK_LOCKED' })
    await expect(generation.setBlockLock(runId, imageBlock.id, false)).resolves.toMatchObject({
      blocks: expect.arrayContaining([expect.objectContaining({ id: imageBlock.id, isLocked: false, lockedAt: null })]),
    })
    await expect(generation.retryBlock(runId, imageBlock.id)).rejects.toMatchObject({
      code: 'TASK_LIMIT_EXCEEDED', message: '该块已达到运行快照规定的最大尝试数',
    })
  })

  it('反馈修正重试超过原自动尝试上限时仍执行一次并携带反馈正文', async () => {
    const runId = await executeMixedRun()
    const initial = await generation.getRun(runId)
    const textBlock = initial.blocks.find(block => block.specKey === 'body')!

    // 先执行普通重试耗尽运行快照中的两次尝试上限。
    await generation.retryBlock(runId, textBlock.id)
    await worker.executeNext()
    expect((await generation.getRun(runId)).blocks.find(block => block.id === textBlock.id)?.attempts).toHaveLength(2)

    const correctionInstruction = '正文太长，请压缩成一句话。'
    const taskId = '00000000-0000-4000-8000-000000009999'
    database.getClient().transaction(() => {
      database.getClient().prepare(`UPDATE generation_runs SET status = 'queued', completed_at = NULL WHERE id = ?`).run(runId)
      database.getClient().prepare(`UPDATE artifact_blocks SET status = 'pending' WHERE id = ?`).run(textBlock.id)
      database.getClient().prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, ?, 'execute_block', ?, 'queued', 0, 2, 9000, 9000)
      `).run(taskId, runId, JSON.stringify({ runId, blockId: textBlock.id, correctionInstruction }))
    }).immediate()

    await worker.executeNext()

    const corrected = await generation.getRun(runId)
    const attempts = corrected.blocks.find(block => block.id === textBlock.id)!.attempts
    expect(attempts).toHaveLength(3)
    const latestInput = database.getClient().prepare(`
      SELECT input_snapshot_json FROM block_attempts WHERE block_id = ? ORDER BY attempt_no DESC LIMIT 1
    `).get(textBlock.id) as { input_snapshot_json: string }
    expect(JSON.parse(latestInput.input_snapshot_json)).toMatchObject({ correctionInstruction })
    expect(model.requests.get('text_block')?.userPrompt).toContain(correctionInstruction)
  })

  it('依赖图片失败时记录依赖错误且不调用后续文字模型', async () => {
    imageModel.shouldFail = true
    const spec = mixedDocumentSpec(false)
    spec.blocks = [
      spec.blocks[1]!,
      { ...spec.blocks[2]!, dependsOn: ['hero'] },
    ]
    const runId = await executeMixedRun(spec)
    const details = await generation.getRun(runId)

    expect(details.run.status).toBe('failed')
    expect(imageModel.calls).toBe(1)
    expect(model.calls.get('text_block')).toBeUndefined()
    expect(details.blocks.find(block => block.specKey === 'body')?.attempts).toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'DEPENDENCY_FAILED' }),
    ])
  })

  it('人物删除同步清理该人物运行的本地图片目录', async () => {
    const runId = await executeMixedRun()
    const details = await generation.getRun(runId)
    const relativePath = details.blocks.find(block => block.type === 'image')!.attempts[0]!.asset!.relativePath
    const absolutePath = resolve(directory, 'artifacts', runId, relativePath)
    expect(existsSync(absolutePath)).toBe(true)

    await contentService.deletePersona(personaId)
    expect(existsSync(absolutePath)).toBe(false)
    await expect(generation.getRun(runId)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })
})
