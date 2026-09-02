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
import type { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { createTestAiPromptService } from '../support/createTestAiPromptService'
import type { AiAlgorithmApplicationService } from '../../server/application/aiConfiguration/AiAlgorithmApplicationService'
import type { AiAlgorithmSnapshot } from '../../server/domain/ai/AiAlgorithmModels'
import type { AiAlgorithmCode } from '../../shared/types/aiConfiguration'
import type { ContextProvider, EvidenceCandidate } from '../../server/ports/ContextProvider'

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
  /** 全部模型请求历史，供批次主调用与单项重试对比固定前缀。 */
  public readonly requestHistory: TextModelRequest[] = []
  /** 是否让第一次兴趣输出故意无效。 */
  public invalidInterestOnce = false
  /** 是否持续返回无效兴趣结构。 */
  public invalidInterestAlways = false
  /** 批量兴趣响应中需要故意遗漏的客户端条目标识。 */
  public omittedInterestItemId: string | null = null
  /** 是否在批量兴趣响应中追加请求之外的条目标识。 */
  public appendUnknownInterestItem = false
  /** 是否让第一次人物草稿错误地包含创建流程元话术。 */
  public invalidPersonaMetaOnce = false
  /** 是否让第一次世界草稿错误地包含创建流程元话术。 */
  public invalidWorldMetaOnce = false
  /** 是否持续返回数量不符的文章配图分析。 */
  public invalidArticleImagesAlways = false
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
    this.requestHistory.push(request)
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
    if (request.responseSchemaName === 'interest_batch_assessment') {
      if (this.interestRateLimitsRemaining > 0) {
        this.interestRateLimitsRemaining -= 1
        throw new TextModelError('PROVIDER_RATE_LIMITED', '测试限流', true)
      }
      if (this.invalidInterestAlways || (this.invalidInterestOnce && call === 1)) return response({ decision: 'invalid' }, this.usage)
      const items = readInterestItems(request.userPrompt)
      const evidence = readEvidence(request.userPrompt)
      const fact = evidence.find(item => item.role === 'canon_fact')
      const result = response({
        results: [
          ...items
          .filter(item => item.itemId !== this.omittedInterestItemId)
          .map(item => ({
            itemId: item.itemId,
            probability: 0.88,
            confidence: 0.82,
            decision: 'interested',
            factors: [{ dimension: 'topic', score: 0.9, explanation: `符合人物对“${item.text}”的兴趣。` }],
            supportingEvidenceIds: fact ? [fact.id] : [],
            opposingEvidenceIds: [],
            unknowns: [],
            reasoningSummary: `人物会关注：${item.text}`,
          })),
          ...(this.appendUnknownInterestItem
            ? [{
                itemId: 'unexpected', probability: 0.5, confidence: 0.5,
                decision: 'insufficient_information',
                factors: [{ dimension: 'topic', score: 0, explanation: '未知条目。' }],
                supportingEvidenceIds: [], opposingEvidenceIds: [], unknowns: ['请求中不存在'],
                reasoningSummary: '请求中不存在的条目。',
              }]
            : []),
        ],
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
    if (request.responseSchemaName === 'article') {
      return response({
        title: '学院观察',
        summary: '以人物口吻介绍学院课程。',
        paragraphs: ['这里的课程值得认真研究。', '每一门课都需要结合可靠资料判断价值。'],
      }, this.usage)
    }
    if (request.responseSchemaName === 'article_images') {
      const imageCount = Number(request.userPrompt.match(/<图片数量>(\d+)<\/图片数量>/)?.[1] ?? 0)
      if (this.invalidArticleImagesAlways) return response({ images: [] }, this.usage)
      return response({
        images: [
          {
            afterParagraph: 0,
            visualBrief: {
              theme: '魔法学院课程', subject: '古代文献图书馆', composition: '横向居中构图', colorPalette: '深蓝与暖金',
              texture: '纸张与木材', aspectRatio: '16:9', altText: '魔法学院古代文献图书馆', negativePrompt: '文字、水印',
            },
          },
          {
            afterParagraph: 1,
            visualBrief: {
              theme: '学院学习', subject: '安静阅读的学生', composition: '中景构图', colorPalette: '暖棕色',
              texture: '自然光', aspectRatio: '4:3', altText: '学生在学院中阅读', negativePrompt: '文字、水印',
            },
          },
        ].slice(0, imageCount),
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

/** 为运行创建返回固定候选的上下文提供器测试适配器。 */
class FixedEvidenceContextProvider implements ContextProvider {
  /**
   * 创建固定候选提供器。
   * @param candidates 已按检索相关性排列的候选。
   */
  constructor(private readonly candidates: EvidenceCandidate[]) {}

  /** @returns 固定使用 OpenViking 路径，以覆盖远端候选二次校验。 */
  getProvider() { return 'openviking' as const }

  /** @returns 固定启用且已配置的 OpenViking 能力。 */
  getOpenVikingCapability() {
    return { configured: true, enabled: true, provider: 'openviking' as const, endpointOrigin: 'https://ov.test' }
  }

  /** @returns 创建时传入的候选副本。 */
  async search() { return { provider: 'openviking' as const, candidates: [...this.candidates] } }
}

/** 返回固定 PNG 或稳定失败的免费测试图片模型。 */
class FixedImageModel implements ImageModelPort {
  /** 图片调用次数。 */
  public calls = 0
  /** 是否让后续调用稳定失败。 */
  public shouldFail = false
  /** 是否模拟二次裁剪并同时返回原图。 */
  public shouldRetainOriginal = false
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
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
    return {
      bytes,
      declaredMediaType: 'image/png',
      ...(this.shouldRetainOriginal
        ? { original: { bytes: new Uint8Array([...bytes, 2]), declaredMediaType: 'image/png' } }
        : {}),
    }
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

/**
 * 读取批量兴趣提示词末尾的稳定条目列表。
 * @param prompt 已渲染的批量兴趣用户提示词。
 * @returns 保持输入顺序的条目标识与文本。
 */
function readInterestItems(prompt: string): Array<{ itemId: string, text: string }> {
  const match = /<待判断文本列表>(.*?)<\/待判断文本列表>/s.exec(prompt)
  const serialized = match?.[1]
  return serialized ? JSON.parse(serialized) as Array<{ itemId: string, text: string }> : []
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
/** 当前测试为固定算法步骤覆盖的最大输出 Token；为空时使用默认测试值。 */
let configuredAlgorithmMaxOutputTokens: number | null = null

beforeEach(async () => {
  configuredAlgorithmMaxOutputTokens = null
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
  generation = new GenerationApplicationService({
    runs: new SqliteRunRepository(database.getClient()), content: contentRepository,
    context: new SqliteContextProvider(database.getClient()), model, prompts: aiPrompts, imageModel, imageAssets,
    identifiers, clock: testClock, sourceProcessor: processor,
    tokenCounter: new ConservativeTokenCounter(), learning: learningRepository,
    algorithms: createGenerationAlgorithms(aiPrompts, model, imageModel),
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

describe('同步优先等待', () => {
  it('兴趣批次在等待期内完成时直接返回完整顺序结果', async () => {
    const created = await generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'first', text: '古代文献整理' }, { itemId: 'second', text: '学院课程安排' }],
    })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })

    await expect(generation.waitForInterestBatch(created.batchId, 1_000)).resolves.toMatchObject({
      mode: 'completed',
      batch: {
        batchId: created.batchId,
        status: 'completed',
        items: [{ itemId: 'first', status: 'succeeded' }, { itemId: 'second', status: 'succeeded' }],
      },
    })
  })

  it('兴趣批次超过等待时间时返回当前队列结果且不取消任务', async () => {
    const created = await generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'pending', text: '尚未执行的内容' }],
    })

    await expect(generation.waitForInterestBatch(created.batchId, 1)).resolves.toMatchObject({
      mode: 'queued',
      batch: { batchId: created.batchId, status: 'queued' },
    })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    await expect(generation.getInterestBatch(created.batchId)).resolves.toMatchObject({ status: 'completed' })
  })

  it('图文运行完成时返回运行详情与直接渲染结果', async () => {
    const created = await generation.createGenerationRun({
      personaId, requirement: '生成纯文本课程简介', outputFormat: 'text', imageCount: 0,
    })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })

    await expect(generation.waitForGenerationRun(created.runId, created.taskId, 1_000)).resolves.toMatchObject({
      mode: 'completed',
      taskId: created.taskId,
      details: { run: { id: created.runId, status: 'succeeded' } },
      result: { runId: created.runId, documents: { txt: expect.stringContaining('这里的课程值得认真研究。') } },
    })
  })
})

describe('阶段三纯文本运行', () => {
  it('系统能力由固定算法链判定，不再依赖迁移前默认模型', async () => {
    const identifiers = new SystemIdentifierGenerator()
    const algorithmOnly = new GenerationApplicationService({
      runs: new SqliteRunRepository(database.getClient()),
      content: new SqliteContentRepository(database.getClient()),
      context: new SqliteContextProvider(database.getClient()),
      model: new DisabledTextModel(),
      prompts: aiPrompts,
      imageModel: new DisabledImageModel(),
      imageAssets,
      identifiers,
      clock: testClock,
      sourceProcessor: new NodeSourceContentProcessor(identifiers),
      tokenCounter: new ConservativeTokenCounter(),
      learning: new SqliteLearningRepository(database.getClient()),
      algorithms: createGenerationAlgorithms(aiPrompts, model, imageModel),
    })

    await expect(algorithmOnly.getCapabilities()).resolves.toMatchObject({
      textModel: { configured: true, model: 'fixed-test-model' },
      imageModel: { configured: true, model: 'fixed-image-model' },
      algorithmCapabilities: {
        articleGeneration: true,
        articleImageGeneration: true,
        interestAssessment: true,
      },
    })
  })

  it('从自然语言和选定资料生成不落库的结构化人物候选草稿', async () => {
    const before = database.getClient().prepare('SELECT COUNT(*) AS count FROM personas').get()
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
    expect(model.calls.get('persona_draft')).toBe(1)
    expect(JSON.stringify(draft)).not.toContain('候选草稿')
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM personas').get()).toEqual(before)
  })

  it('从自然语言生成不落库的结构化世界候选草稿', async () => {
    const before = database.getClient().prepare('SELECT COUNT(*) AS count FROM worlds').get()
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
    expect(model.calls.get('world_draft')).toBe(1)
    expect(model.requests.get('world_draft')?.parameters.temperature).toBe(0.4)
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
      promptVersion: 'algorithm:interest_assessment:v1',
      contextProvider: 'sqlite_fts5',
      promptContext: {
        aiPromptVersions: {
          'generation.interest_assessment': expect.any(String),
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
    expect(details.run.result?.supportingEvidenceIds).toEqual(details.evidence[3] ? [details.evidence[3].id] : [])
    expect(model.requests.get('interest_batch_assessment')?.systemPrompt).toContain('<当前人物成长提示词>"回答时先给简洁结论。"</当前人物成长提示词>')
    expect(model.requests.get('interest_batch_assessment')?.systemPrompt).toContain('<当前人物记忆提示词>"过去处理事实内容时会优先核验依据。"</当前人物记忆提示词>')
    expect(model.calls.get('interest_batch_assessment')).toBe(1)
    expect(database.getClient().prepare('SELECT usage_json FROM interest_batches WHERE id = (SELECT batch_id FROM interest_batch_items WHERE run_id = ?)').get(created.runId))
      .toEqual({ usage_json: JSON.stringify({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }) })
    expect(database.getClient().prepare(`
      SELECT persona_id, run_id, operation_type, is_enabled FROM persona_operation_records WHERE run_id = ?
    `).get(created.runId)).toEqual({
      persona_id: personaId, run_id: created.runId, operation_type: 'interest_assessment', is_enabled: 1,
    })
  })

  it('全局资料通过当前范围与切片哈希校验后进入运行证据', async () => {
    const global = await contentService.createPastedSource({
      name: '全局共同规则', role: 'canon_fact', content: '所有人物都必须优先说明资料中的明确限制。',
    })
    await contentService.replaceGlobalSources({ sourceIds: [global.source.id] })

    const created = await generation.createInterestRun({ personaId, content: '资料中的明确限制是什么？' })
    const details = await generation.getRun(created.runId)

    expect(details.run.promptContext.selected).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'source', contentHash: global.chunks[0]?.contentHash }),
    ]))
    expect(details.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: global.source.id, chunkId: global.chunks[0]?.id }),
    ]))
  })

  it('当前人物的有效成长候选通过修订正文和哈希校验后进入运行证据', async () => {
    await learningService.createGrowth('persona', personaId, {
      content: '人物会优先研究具有可靠档案依据的课程。', importance: 5, sourceIds: [],
    })
    const repository = new SqliteLearningRepository(database.getClient())
    const growth = (await repository.listGrowth('persona', personaId))[0]!
    await learningService.updateGrowthStates('persona', personaId, { ids: [growth.id], status: 'active' })
    const identifiers = new SystemIdentifierGenerator()
    const processor = new NodeSourceContentProcessor(identifiers)
    const service = new GenerationApplicationService({
      runs: new SqliteRunRepository(database.getClient()), content: new SqliteContentRepository(database.getClient()),
      context: new FixedEvidenceContextProvider([{
        entityType: 'persona_growth', entityId: growth.id, sourceId: null, chunkId: null,
        role: 'growth', heading: '有效成长', content: growth.content,
        contentHash: processor.hash(growth.content), priority: 0,
      }]),
      model, prompts: aiPrompts, imageModel, imageAssets, identifiers, clock: testClock,
      sourceProcessor: processor, tokenCounter: new ConservativeTokenCounter(), learning: repository,
      algorithms: createGenerationAlgorithms(aiPrompts, model, imageModel),
    })

    const created = await service.createInterestRun({ personaId, content: '档案课程' })
    const details = await service.getRun(created.runId)

    expect(details.run.promptContext.selected).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: growth.id, category: 'persona_growth', skippedReason: null }),
    ]))
  })

  it('同一人物多条文本只调用一次模型并按输入顺序独立保存结果', async () => {
    const created = await generation.createInterestBatch({
      personaId,
      additionalPrompt: '只按人物长期兴趣判断，不考虑短期热点。',
      items: [
        { itemId: 'topic-3', text: '古代文献整理' },
        { itemId: 'topic-1', text: '学院课程安排' },
        { itemId: 'topic-2', text: '无关娱乐新闻' },
      ],
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const completed = await generation.getInterestBatch(created.batchId)

    expect(model.calls.get('interest_batch_assessment')).toBe(1)
    expect(model.requests.get('interest_batch_assessment')?.userPrompt)
      .toContain('<附加提示词>"只按人物长期兴趣判断，不考虑短期热点。"</附加提示词>')
    expect(completed.items.map(item => item.itemId)).toEqual(['topic-3', 'topic-1', 'topic-2'])
    expect(completed.items.map(item => item.text)).toEqual(['古代文献整理', '学院课程安排', '无关娱乐新闻'])
    expect(completed.additionalPrompt).toBe('只按人物长期兴趣判断，不考虑短期热点。')
    expect(completed.items.map(item => item.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    expect(completed.items.every(item => item.runId.length > 0)).toBe(true)
    expect(new Set(completed.items.map(item => item.runId)).size).toBe(3)
  })

  it('批量结果缺项只失败对应条目且单项重试不重跑全批', async () => {
    await learningService.saveLearningPromptDraft('persona_growth', personaId, {
      promptText: '批量判断时优先核验事实依据。', baseVersionId: null,
    })
    await learningService.publishLearningPromptDraft('persona_growth', personaId, { changeSummary: '建立批量判断成长提示词' })
    model.omittedInterestItemId = 'missing'
    const created = await generation.createInterestBatch({
      personaId,
      additionalPrompt: '失败条目重试时继续使用这条附加要求。',
      items: [
        { itemId: 'first', text: '第一条文本' },
        { itemId: 'missing', text: '需要重试的文本' },
        { itemId: 'last', text: '最后一条文本' },
      ],
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const partial = await generation.getInterestBatch(created.batchId)
    expect(partial.items.map(item => item.status)).toEqual(['succeeded', 'failed', 'succeeded'])
    expect(partial.items[1]?.error).toMatchObject({ code: 'MODEL_OUTPUT_INVALID' })

    model.omittedInterestItemId = null
    await generation.retryInterestBatchItem(created.batchId, 'missing')
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const retried = await generation.getInterestBatch(created.batchId)
    expect(retried.items.map(item => item.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    expect(model.calls.get('interest_batch_assessment')).toBe(2)
    expect(readInterestItems(model.requests.get('interest_batch_assessment')?.userPrompt ?? ''))
      .toEqual([{ itemId: 'missing', text: '需要重试的文本' }])
    const interestRequests = model.requestHistory.filter(request => request.responseSchemaName === 'interest_batch_assessment')
    expect(interestRequests).toHaveLength(2)
    expect(interestRequests[0]?.systemPrompt).toBe(interestRequests[1]?.systemPrompt)
    expect(interestRequests[0]?.systemPrompt).toContain(PERSONA_SNAPSHOT.promptText)
    expect(interestRequests[0]?.userPrompt).not.toContain(PERSONA_SNAPSHOT.promptText)
    expect(interestRequests[1]?.userPrompt).not.toBe(interestRequests[0]?.userPrompt)
    expect(interestRequests[1]?.userPrompt)
      .toContain('<附加提示词>"失败条目重试时继续使用这条附加要求。"</附加提示词>')
  })

  it('批量结果出现请求之外的条目标识时拒绝整次模型响应', async () => {
    model.appendUnknownInterestItem = true
    const created = await generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'first', text: '第一条文本' }, { itemId: 'second', text: '第二条文本' }],
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })
    const failed = await generation.getInterestBatch(created.batchId)
    expect(failed.items.map(item => item.status)).toEqual(['failed', 'failed'])
    expect(failed.items.every(item => item.error?.code === 'MODEL_OUTPUT_INVALID')).toBe(true)
  })

  it('批量兴趣输入拒绝重复编号、空文本和超过固定批量上限', async () => {
    await expect(generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'same', text: '有效文本' }, { itemId: 'same', text: '重复编号' }],
    })).rejects.toThrow('同一批次的条目标识不能重复')
    await expect(generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'empty', text: '   ' }],
    })).rejects.toThrow('待判断文本不能为空')
    await expect(generation.createInterestBatch({
      personaId,
      items: Array.from({ length: 21 }, (_, index) => ({ itemId: String(index), text: '测试' })),
    })).rejects.toThrow('单批次最多包含 20 条文本')
    await expect(generation.createInterestBatch({
      personaId,
      additionalPrompt: '附加要求'.repeat(1_001),
      items: [{ itemId: 'prompt-too-long', text: '测试' }],
    })).rejects.toThrow('附加提示词不能超过 4000 个字符')
  })

  it('批量主调用整体结构错误时完整重新排队并在下一次尝试恢复', async () => {
    model.invalidInterestOnce = true
    const created = await generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'a', text: '第一条' }, { itemId: 'b', text: '第二条' }],
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })
    expect((await generation.getInterestBatch(created.batchId)).items.map(item => item.status)).toEqual(['queued', 'queued'])
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect((await generation.getInterestBatch(created.batchId)).items.map(item => item.status)).toEqual(['succeeded', 'succeeded'])
    expect(model.calls.get('interest_batch_assessment')).toBe(2)
  })

  it('批量任务租约过期时恢复全部运行而不是只恢复任务锚点', async () => {
    const created = await generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'a', text: '第一条' }, { itemId: 'b', text: '第二条' }],
    })
    const runIds = created.items.map(item => item.runId)
    const placeholders = runIds.map(() => '?').join(', ')
    database.getClient().prepare(`UPDATE generation_runs SET status = 'running' WHERE id IN (${placeholders})`).run(...runIds)
    database.getClient().prepare(`
      UPDATE task_jobs SET status = 'running', attempt_count = 1, lease_until = 2000
      WHERE run_id = ?
    `).run(runIds[0])

    await expect(new SqliteTaskJobRepository(database.getClient()).recoverExpired(2_001)).resolves.toBe(1)
    expect((await generation.getInterestBatch(created.batchId)).items.map(item => item.status)).toEqual(['queued', 'queued'])
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

  it('兴趣算法参数独立于旧系统 AI 设置并保存运行快照', async () => {
    const profile = await generation.createParameterProfile({
      name: '极小提示上限',
      values: { ...DEFAULT_TEXT_PARAMETERS, maxPromptCharacters: 1_000 },
    })
    const created = await generation.createInterestRun({ personaId, content: '长内容'.repeat(500) })

    const details = await generation.getRun(created.runId)
    expect(profile.values.maxPromptCharacters).toBe(1_000)
    expect(details.run.parameters).toMatchObject({ temperature: 0.4, maxPromptCharacters: 120_000 })
    const snapshot = database.getClient().prepare('SELECT interest_algorithm_snapshot_json FROM generation_runs WHERE id = ?')
      .get(created.runId) as { interest_algorithm_snapshot_json: string }
    expect(JSON.parse(snapshot.interest_algorithm_snapshot_json)).toMatchObject({
      algorithmCode: 'interest_assessment', steps: [{ parameters: { temperature: 0.4 } }],
    })
    expect(database.getClient().prepare('SELECT parameter_profile_id FROM generation_runs WHERE id = ?').get(created.runId))
      .toEqual({ parameter_profile_id: null })
  })

  it.each([0, 4_096])('兴趣算法输出 Token 为 %i 时保留合法运行快照', async (maxOutputTokens) => {
    configuredAlgorithmMaxOutputTokens = maxOutputTokens

    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    const details = await generation.getRun(created.runId)

    expect(details.run.parameters).toMatchObject({ maxOutputTokens, reservedOutputTokens: 4_096 })
    const snapshot = database.getClient().prepare('SELECT interest_algorithm_snapshot_json FROM generation_runs WHERE id = ?')
      .get(created.runId) as { interest_algorithm_snapshot_json: string }
    expect(JSON.parse(snapshot.interest_algorithm_snapshot_json)).toMatchObject({
      steps: [{ parameters: { maxOutputTokens } }],
    })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(model.requests.get('interest_batch_assessment')?.parameters.maxOutputTokens).toBe(maxOutputTokens)
  })

  it('兴趣算法正数输出 Token 超过预留输出时拒绝创建运行', async () => {
    configuredAlgorithmMaxOutputTokens = 4_097

    await expect(generation.createInterestRun({ personaId, content: '魔法学院课程' }))
      .rejects.toThrow('最大输出 Token 不能超过预留输出 Token')
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

  it('提交创作条件后无需确认即可直接生成最终文章', async () => {
    const created = await generation.createGenerationRun({
      personaId,
      requirement: '用人物风格介绍魔法学院课程。',
      outputFormat: 'text',
      imageCount: 0,
    })

    await worker.executeNext()
    await worker.executeNext()

    const completed = await generation.getRun(created.runId)
    expect(completed.run.status).toBe('succeeded')
    expect(completed.documentSpecs).toEqual([
      expect.objectContaining({ status: 'confirmed' }),
    ])
    expect(completed.blocks.map(block => block.attempts[0]?.outputText)).toEqual([
      '这里的课程值得认真研究。',
      '每一门课都需要结合可靠资料判断价值。',
    ])
    const snapshot = database.getClient().prepare(`
      SELECT algorithm_snapshot_json FROM generation_runs WHERE id = ?
    `).get(created.runId) as { algorithm_snapshot_json: string }
    expect(JSON.parse(snapshot.algorithm_snapshot_json)).toMatchObject({
      articleGeneration: { algorithmCode: 'article_generation', steps: [{ parameters: { temperature: 0.65 } }] },
      articleImageAnalysis: null,
    })
    const articleRequest = model.requests.get('article')
    expect(articleRequest?.parameters.temperature).toBe(0.65)
    expect(articleRequest?.systemPrompt).toContain(PERSONA_SNAPSHOT.promptText)
    expect(articleRequest?.userPrompt).not.toContain(PERSONA_SNAPSHOT.promptText)
  })

  it('排队运行可协作取消且不会再被 Worker 领取', async () => {
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程' })
    await generation.cancelRun(created.runId)
    expect((await generation.getRun(created.runId)).run.status).toBe('canceled')
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: false })
  })

  it('取消批次任意条目时会终止全批次且不再执行主任务', async () => {
    const created = await generation.createInterestBatch({
      personaId,
      items: [{ itemId: 'a', text: '第一条' }, { itemId: 'b', text: '第二条' }],
    })

    await generation.cancelRun(created.items[1]?.runId ?? '')

    const canceled = await generation.getInterestBatch(created.batchId)
    expect(canceled.items.map(item => item.status)).toEqual(['failed', 'failed'])
    expect(canceled.items.map(item => item.error?.code)).toEqual(['RUN_CANCELED', 'RUN_CANCELED'])
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: false })
    expect(model.calls.get('interest_batch_assessment')).toBeUndefined()
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
    await expect(disabled.createInterestRun({ personaId, content: '测试' })).rejects.toMatchObject({ code: 'AI_ALGORITHM_NOT_CONFIGURED' })
    await expect(disabled.generatePersonaDraft({ prompt: '测试人物', sourceIds: [] }))
      .rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await expect(disabled.generateWorldDraft({ prompt: '测试世界' }))
      .rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM generation_runs').get()).toEqual({ count: 0 })
  })

  it('临时限流先自动重新排队并在第二次任务尝试成功', async () => {
    model.interestRateLimitsRemaining = 1
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
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    })
    expect(failed.tasks[0]).toMatchObject({ status: 'failed', attemptCount: 2 })

    model.invalidInterestAlways = false
    const retried = await generation.retryRun(created.runId)
    expect(retried.taskId).not.toBe(created.taskId)
    await worker.executeNext()
    const completed = await generation.getRun(created.runId)
    expect(completed.run.usage).toEqual({ inputTokens: 30, outputTokens: 15, totalTokens: 45 })
    expect(completed.run.status).toBe('succeeded')
    expect(completed.tasks.map(task => task.status).sort()).toEqual(['failed', 'succeeded'])
  })

  it('租约过期后恢复中断块，保留失败尝试并继续后续块', async () => {
    const created = await generation.createGenerationRun({ personaId, requirement: '介绍课程' })
    await worker.executeNext()
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

/**
 * 使用现有固定模型模拟数据库算法执行接缝，验证生成服务确实读取运行算法快照。
 * @param prompts 真实迁移提示词目录。
 * @param textModel 可观察的免费测试文本模型。
 * @param imageModel 可观察的免费测试图片模型。
 * @returns 只实现生成服务所需准备与执行方法的算法服务。
 */
function createGenerationAlgorithms(
  prompts: AiPromptApplicationService,
  textModel: FixedTextModel,
  imageModel: FixedImageModel,
): Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep' | 'executeImageStep'> {
  return {
    /** @param code 当前生成服务请求的算法编码。 @returns 固定单步骤快照。 */
    async prepare(code: AiAlgorithmCode): Promise<AiAlgorithmSnapshot> {
      const definition = generationTestAlgorithmDefinition(code)
      const promptCode = definition.promptCode
      const versions = await prompts.snapshotPublishedVersions([promptCode])
      return {
        algorithmCode: code,
        implementationVersion: 1,
        configurationVersionId: '00000000-0000-4000-8000-000000000700',
        configurationVersion: 1,
        steps: [{
          stepKey: definition.stepKey, ordinal: 0,
          modelDeploymentId: '00000000-0000-4000-8000-000000000703',
          connectionId: '00000000-0000-4000-8000-000000000704',
          protocol: 'openai_compatible', endpoint: 'https://model.test/v1', userAgent: '',
          model: definition.modality === 'text' ? 'fixed-test-model' : 'fixed-image-model',
          modality: definition.modality,
          promptCode, promptVersionId: versions[promptCode]!,
          parameters: {
            temperature: code === 'article_generation' ? 0.65 : code === 'article_image_analysis' ? 0.15 : 0.4,
            maxOutputTokens: configuredAlgorithmMaxOutputTokens ?? (code === 'article_generation' ? 4_096 : 2_048),
            timeoutMs: 60_000,
          },
        }],
      }
    },
    /** @param snapshot 固定算法快照。 @param stepKey 步骤键。 @param variables 模板变量。 @param responseSchemaName 响应结构名。 @param responseFormat 响应格式。 @returns 测试模型响应。 */
    async executeStep(snapshot, stepKey, variables, responseSchemaName, responseFormat) {
      const step = snapshot.steps.find(item => item.stepKey === stepKey)
      if (!step) throw new Error('测试算法步骤不存在')
      const prompt = await prompts.render(step.promptCode, variables, step.promptVersionId)
      return await textModel.generateStructured({
        ...prompt,
        parameters: { ...DEFAULT_TEXT_PARAMETERS, ...step.parameters },
        responseSchemaName,
        responseFormat,
      })
    },
    /** @param snapshot 固定图片算法快照。 @param stepKey 图片步骤键。 @param variables 模板变量。 @param aspectRatio 固定宽高比。 @returns 测试图片响应。 */
    async executeImageStep(snapshot, stepKey, variables, aspectRatio) {
      const step = snapshot.steps.find(item => item.stepKey === stepKey)
      if (!step) throw new Error('测试图片算法步骤不存在')
      const prompt = await prompts.render(step.promptCode, variables, step.promptVersionId)
      return await imageModel.generate({ prompt: prompt.userPrompt, aspectRatio, timeoutMs: step.parameters.timeoutMs })
    },
  }
}

/**
 * 返回生成服务测试覆盖到的固定单步骤算法定义。
 * @param code 生成服务可能请求的算法编码。
 * @returns 步骤键、提示词编码和模型类型。
 */
function generationTestAlgorithmDefinition(code: AiAlgorithmCode): {
  stepKey: string
  promptCode: string
  modality: 'text' | 'image'
} {
  if (code === 'persona_draft') return { stepKey: 'generate', promptCode: 'generation.persona_draft', modality: 'text' }
  if (code === 'world_draft') return { stepKey: 'generate', promptCode: 'generation.world_draft', modality: 'text' }
  if (code === 'interest_assessment') return { stepKey: 'assess', promptCode: 'generation.interest_assessment', modality: 'text' }
  if (code === 'article_generation') return { stepKey: 'generate', promptCode: 'generation.article', modality: 'text' }
  if (code === 'article_image_analysis') return { stepKey: 'analyze', promptCode: 'generation.article_images', modality: 'text' }
  if (code === 'article_text_revision') return { stepKey: 'revise', promptCode: 'generation.text_block', modality: 'text' }
  if (code === 'article_image_generation') return { stepKey: 'generate', promptCode: 'generation.image_block', modality: 'image' }
  throw new Error(`测试未配置算法：${code}`)
}

/**
 * 按新契约完成一次直接图文生成。
 * @param outputFormat 用户要求的最终输出格式。
 * @param imageCount 文章完成后需要生成的图片数量。
 * @returns 已完成运行的 UUID。
 */
async function executeDirectRun(outputFormat: 'html' | 'text' = 'html', imageCount = 1): Promise<string> {
  const created = await generation.createGenerationRun({
    personaId,
    requirement: '图文介绍学院课程',
    outputFormat,
    imageCount,
  })
  await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
  await expect(worker.executeNext()).resolves.toMatchObject({ handled: true })
  return created.runId
}

describe('直接图文生成与导出', () => {
  it('HTML 格式按文章分析位置从头到尾插入指定数量图片', async () => {
    const created = await generation.createGenerationRun({
      personaId,
      requirement: '生成一篇图文混排的课程介绍。',
      outputFormat: 'html',
      imageCount: 2,
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })

    const rendered = await generation.renderRun(created.runId, ['html'])
    const html = rendered.documents.html ?? ''
    const firstParagraph = html.indexOf('这里的课程值得认真研究。')
    const firstImage = html.indexOf('<figure>')
    const secondParagraph = html.indexOf('每一门课都需要结合可靠资料判断价值。')
    const secondImage = html.indexOf('<figure>', firstImage + 1)
    expect([firstParagraph, firstImage, secondParagraph, secondImage].every(index => index >= 0)).toBe(true)
    expect(firstParagraph).toBeLessThan(firstImage)
    expect(firstImage).toBeLessThan(secondParagraph)
    expect(secondParagraph).toBeLessThan(secondImage)
    expect(rendered.assets).toHaveLength(2)
  })

  it('文本格式分别返回文章正文和图片数据', async () => {
    const created = await generation.createGenerationRun({
      personaId,
      requirement: '生成一篇带一张配图的课程介绍。',
      outputFormat: 'text',
      imageCount: 1,
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })

    await expect(generation.getRun(created.runId)).resolves.toMatchObject({ run: { status: 'succeeded' } })
    const rendered = await generation.renderRun(created.runId, ['txt'])
    expect(rendered.documents.txt).toContain('这里的课程值得认真研究。')
    expect(rendered.documents.txt).not.toContain('[图片：')
    expect(rendered.assets).toEqual([
      expect.objectContaining({ altText: '魔法学院古代文献图书馆' }),
    ])
  })

  it('配图分析数量与请求不符时以模型输出无效稳定失败', async () => {
    model.invalidArticleImagesAlways = true
    const created = await generation.createGenerationRun({
      personaId,
      requirement: '生成一篇带一张配图的课程介绍。',
      outputFormat: 'html',
      imageCount: 1,
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })

    await expect(generation.getRun(created.runId)).resolves.toMatchObject({
      run: { status: 'failed', errorCode: 'MODEL_OUTPUT_INVALID' },
    })
    expect(imageModel.calls).toBe(0)
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

    await expect(disabled.createGenerationRun({ personaId, requirement: '生成图文', outputFormat: 'html', imageCount: 1 }))
      .rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await expect(disabled.createGenerationRun({ personaId, requirement: '仅生成文字', outputFormat: 'text', imageCount: 0 }))
      .resolves.toMatchObject({ status: 'planning' })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM generation_runs').get()).toEqual({ count: 1 })
  })

  it('生成固定 PNG 并从最终结果渲染及导出 HTML', async () => {
    imageModel.shouldRetainOriginal = true
    const runId = await executeDirectRun()
    const details = await generation.getRun(runId)
    const imageBlock = details.blocks.find(block => block.type === 'image')!
    const asset = imageBlock.attempts[0]!.asset!

    expect(details.run).toMatchObject({ status: 'succeeded', input: { outputFormat: 'html', imageCount: 1 }, imageModel: { model: 'fixed-image-model' } })
    expect(imageModel.calls).toBe(1)
    expect(imageModel.lastRequest).toMatchObject({ aspectRatio: '16:9' })
    expect(imageModel.lastRequest?.prompt).toContain('古代文献图书馆')
    expect(imageModel.lastRequest?.prompt).not.toContain('<当前世界成长提示词>')
    expect(imageModel.lastRequest?.prompt).not.toContain('<当前人物成长提示词>')
    expect(imageModel.lastRequest?.prompt).not.toContain('<当前人物记忆提示词>')
    expect(imageModel.lastRequest?.prompt).not.toContain('<不可信参考资料>')
    expect(existsSync(resolve(directory, 'artifacts', runId, asset.relativePath))).toBe(true)
    expect(asset.original).not.toBeNull()
    if (!asset.original) throw new Error('裁剪图片缺少原图资产')
    expect(existsSync(resolve(directory, 'artifacts', runId, asset.original.relativePath))).toBe(true)
    await expect(generation.getImageAsset(runId, asset.id)).resolves.toMatchObject({ mediaType: 'image/png' })
    await expect(generation.getImageAsset(runId, asset.id, 'original')).resolves.toMatchObject({ mediaType: 'image/png' })

    const rendered = await generation.renderRun(runId, ['html'])
    expect(rendered.assets).toEqual([expect.objectContaining({ id: asset.id, relativePath: asset.relativePath })])
    expect(rendered.documents.html).toContain('学院观察')
    const exported = await generation.exportRun(runId, 'html')
    expect(exported).toMatchObject({ fileName: expect.stringMatching(/\.zip$/), mediaType: 'application/zip' })
    const names = Object.keys(unzipSync(exported.bytes))
    expect(names).toContain('document.html')
    expect(names).toContain(asset.relativePath)
    expect(names).toContain('manifest.json')
  })

  it('图片失败时保留成功文章并标记部分成功，整体重试只处理失败图片', async () => {
    imageModel.shouldFail = true
    const runId = await executeDirectRun()
    const partial = await generation.getRun(runId)
    const imageBlock = partial.blocks.find(block => block.type === 'image')!
    const textAttempts = partial.blocks.filter(block => block.type === 'text').map(block => block.attempts.length)

    expect(partial.run.status).toBe('partial')
    expect(imageBlock.attempts).toEqual([expect.objectContaining({ status: 'failed', errorCode: 'IMAGE_OUTPUT_INVALID' })])
    expect(partial.blocks.filter(block => block.type === 'text').every(block => block.status === 'succeeded')).toBe(true)

    imageModel.shouldFail = false
    await generation.retryRun(runId)
    await worker.executeNext()
    const recovered = await generation.getRun(runId)
    expect(recovered.run.status).toBe('succeeded')
    expect(recovered.blocks.filter(block => block.type === 'text').map(block => block.attempts.length)).toEqual(textAttempts)
    expect(recovered.blocks.find(block => block.id === imageBlock.id)?.attempts).toHaveLength(2)
  })

  it('人物删除同步清理该人物运行的本地图片目录', async () => {
    const runId = await executeDirectRun()
    const details = await generation.getRun(runId)
    const relativePath = details.blocks.find(block => block.type === 'image')!.attempts[0]!.asset!.relativePath
    const absolutePath = resolve(directory, 'artifacts', runId, relativePath)
    expect(existsSync(absolutePath)).toBe(true)

    await contentService.deletePersona(personaId)
    expect(existsSync(absolutePath)).toBe(false)
    await expect(generation.getRun(runId)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })
})
