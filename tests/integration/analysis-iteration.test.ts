import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { AnalysisApplicationService } from '../../server/application/analysis/AnalysisApplicationService'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { SoulApplicationService } from '../../server/application/content/SoulApplicationService'
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

/** 根据批次输入返回一条新增成长提案的固定测试模型。 */
class AnalysisTextModel implements TextModelPort {
  /** @returns 固定非敏感模型快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible' as const, model: 'analysis-test-model', endpointOrigin: 'https://model.test' }
  }

  /** @param request 结构化分析请求。 @returns 引用真实批次输入 UUID 的固定提案。 */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    const rawInputs = /<不可信原始输入>(.*?)<\/不可信原始输入>/s.exec(request.userPrompt)?.[1] ?? '[]'
    const inputs = JSON.parse(rawInputs) as Array<{ id: string }>
    return {
      structuredOutput: {
        proposals: [{
          operation: 'add', targetType: 'growth', targetIds: [],
          proposed: { content: '城邦规划必须优先考虑稳定水运。', scope: '涉及城邦规划时', importance: 4 },
          evidenceInputIds: [inputs[0]!.id], conflicts: [], rationale: '资料明确说明城邦依水而建。',
        }],
        summary: '发现一条可复用世界规则。',
      },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    }
  }
}

let directory: string
let database: SqliteDatabase
let content: ContentApplicationService
let souls: SoulApplicationService
let analysis: AnalysisApplicationService
let worker: WorkerApplicationService
let worldId: string

beforeEach(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-analysis-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  const identifiers = new SequentialIdentifierGenerator()
  const clock = new TestClock()
  const contentRepository = new SqliteContentRepository(database.getClient())
  const learningRepository = new SqliteLearningRepository(database.getClient())
  const processor = new NodeSourceContentProcessor(identifiers)
  content = new ContentApplicationService({
    repository: contentRepository,
    souls: contentRepository,
    identifiers,
    clock,
    tokenCounter: new ConservativeTokenCounter(),
    tokenBudgets: { world: 2_500, persona: 3_500 },
    sourceProcessor: processor,
    sourceFiles: new LocalSourceFileStorage(directory),
  })
  souls = new SoulApplicationService({
    content: contentRepository,
    souls: contentRepository,
    identifiers,
    clock,
    tokenCounter: new ConservativeTokenCounter(),
    tokenBudgets: { world: 2_500, persona: 3_500 },
  })
  const analysisRepository = new SqliteAnalysisRepository(database.getClient())
  analysis = new AnalysisApplicationService({
    content: contentRepository,
    souls: contentRepository,
    learning: learningRepository,
    analysis: analysisRepository,
    model: new AnalysisTextModel(),
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
    name: '水城世界', summary: '',
    snapshot: {
      promptText: '城邦文明依赖河网。',
    },
    changeSummary: '建立世界',
  })
  worldId = world.world.id
  await souls.publishDraft('world', worldId)
  const source = await content.createPastedSource({ name: '城邦资料', role: 'canon_fact', content: '主要城邦依水而建，运输依赖河道。' })
  await content.linkSource(source.source.id, { targetType: 'world', targetId: worldId, priority: 10 })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('AI 迭代提案与人工审核', () => {
  it('模型分析只形成待审核提案，人工接受后才创建有效成长', async () => {
    const queued = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    expect(queued).toMatchObject({ status: 'queued', proposals: [] })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM growth_records`).get()).toEqual({ count: 0 })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const proposed = await analysis.getBatch(queued.id)
    expect(proposed).toMatchObject({ status: 'awaiting_review' })
    expect(proposed.proposals).toEqual([expect.objectContaining({ operation: 'add', status: 'pending' })])
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM growth_records`).get()).toEqual({ count: 0 })

    const reviewed = await analysis.review(queued.id, {
      decisions: [{
        proposalId: proposed.proposals[0]!.id,
        action: 'accept',
        reviewed: { content: '水路稳定性是城邦规划的首要条件。', scope: '规划城邦时', importance: 5 },
      }],
    })
    expect(reviewed).toMatchObject({ status: 'completed' })
    expect(database.getClient().prepare(`
      SELECT growth_records.status, growth_revisions.content, growth_revisions.scope, growth_revisions.importance
      FROM growth_records INNER JOIN growth_revisions ON growth_revisions.id = growth_records.current_revision_id
    `).get()).toEqual({ status: 'active', content: '水路稳定性是城邦规划的首要条件。', scope: '所有新任务', importance: 5 })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM growth_revision_evidence`).get()).toEqual({ count: 1 })
  })

  it('增量分析不会在没有新增输入时重复创建批次，完整重建仍可人工发起', async () => {
    const first = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    await worker.executeNext()
    await expect(analysis.createBatch('world_growth', worldId, { mode: 'incremental' }))
      .rejects.toMatchObject({ code: 'NO_NEW_ANALYSIS_INPUT', statusCode: 409 })
    const rebuild = await analysis.createBatch('world_growth', worldId, { mode: 'full_rebuild' })
    expect(rebuild).toMatchObject({ mode: 'full_rebuild', status: 'queued' })
    expect(rebuild.id).not.toBe(first.id)
  })

  it('拒绝提案只记录审核结果，不创建长期内容', async () => {
    const batch = await analysis.createBatch('world_growth', worldId, { mode: 'incremental' })
    await worker.executeNext()
    const proposed = await analysis.getBatch(batch.id)
    const reviewed = await analysis.review(batch.id, {
      decisions: [{ proposalId: proposed.proposals[0]!.id, action: 'reject', reason: '这只是局部城市规则' }],
    })
    expect(reviewed.proposals[0]).toMatchObject({ status: 'rejected', reviewReason: '这只是局部城市规则' })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM growth_records`).get()).toEqual({ count: 0 })
  })
})
