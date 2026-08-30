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
   * 返回符合新学习提示词契约的完整草稿。
   * @param request 结构化分析请求。
   * @returns 固定完整提示词和提炼摘要。
   */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    this.lastRequest = request
    return {
      structuredOutput: {
        promptText: '进行城邦规划时，优先保障稳定水运，并明确区分确定事实与推断。',
        summary: '综合水运资料，形成城邦规划经验。',
      },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    }
  }
}

let directory: string
let database: SqliteDatabase
let analysis: AnalysisApplicationService
let learning: LearningApplicationService
let worker: WorkerApplicationService
let model: AnalysisTextModel
let worldId: string

beforeEach(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-analysis-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  const identifiers = new SequentialIdentifierGenerator()
  const clock = new TestClock()
  const tokenCounter = new ConservativeTokenCounter()
  const contentRepository = new SqliteContentRepository(database.getClient())
  const learningRepository = new SqliteLearningRepository(database.getClient())
  const processor = new NodeSourceContentProcessor(identifiers)
  const content = new ContentApplicationService({
    repository: contentRepository,
    souls: contentRepository,
    identifiers,
    clock,
    tokenCounter,
    tokenBudgets: { world: 2_500, persona: 3_500 },
    sourceProcessor: processor,
    sourceFiles: new LocalSourceFileStorage(directory),
  })
  const souls = new SoulApplicationService({
    content: contentRepository,
    souls: contentRepository,
    identifiers,
    clock,
    tokenCounter,
    tokenBudgets: { world: 2_500, persona: 3_500 },
  })
  learning = new LearningApplicationService({
    content: contentRepository,
    learning: learningRepository,
    identifiers,
    clock,
    tokenCounter,
    promptTokenBudgets: { world_growth: 2_500, persona_growth: 2_500, persona_memory: 3_000 },
  })
  const analysisRepository = new SqliteAnalysisRepository(database.getClient())
  model = new AnalysisTextModel()
  analysis = new AnalysisApplicationService({
    content: contentRepository,
    souls: contentRepository,
    learning: learningRepository,
    analysis: analysisRepository,
    model,
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
      status: 'completed', resultSummary: '综合水运资料，形成城邦规划经验。', proposals: [],
      inputs: [expect.objectContaining({ inputType: 'growth_material', importance: 5 })],
    })
    expect(model.lastRequest?.userPrompt).toContain('"importance":5')

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

  it('增量提炼不会重复消费同正文同评分素材，完整重建仍可发起', async () => {
    const first = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    await worker.executeNext()
    await expect(analysis.createBatch('world_growth', worldId, { mode: 'incremental' }))
      .rejects.toMatchObject({ code: 'NO_NEW_ANALYSIS_INPUT', statusCode: 409 })

    const rebuild = await analysis.createBatch('world_growth', worldId, { mode: 'full_rebuild' })
    expect(rebuild).toMatchObject({ mode: 'full_rebuild', status: 'queued' })
    expect(rebuild.id).not.toBe(first.id)
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
})
