import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { SoulApplicationService } from '../../server/application/content/SoulApplicationService'
import { LearningApplicationService } from '../../server/application/learning/LearningApplicationService'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteLearningRepository } from '../../server/infrastructure/database/SqliteLearningRepository'
import { ConservativeTokenCounter } from '../../server/infrastructure/model/ConservativeTokenCounter'
import type { Clock } from '../../server/ports/Clock'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'

/** 为学习闭环测试提供稳定 UUID。 */
class SequentialIdentifierGenerator implements IdentifierGenerator {
  /** 当前测试序号。 */
  private sequence = 0

  /** @returns 下一个格式合法且可预测的 UUID。 */
  create(): string {
    this.sequence += 1
    return `10000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

/** 为学习闭环测试提供固定时间。 */
class FixedClock implements Clock {
  /** @returns 固定 UTC Unix 毫秒。 */
  now(): number {
    return 10_000
  }
}

let temporaryDirectory: string
let database: SqliteDatabase
let content: ContentApplicationService
let souls: SoulApplicationService
let learning: LearningApplicationService

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-learning-test-'))
  database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  const identifiers = new SequentialIdentifierGenerator()
  const clock = new FixedClock()
  const repository = new SqliteContentRepository(database.getClient())
  content = new ContentApplicationService({
    repository,
    souls: repository,
    identifiers,
    clock,
    sourceProcessor: new NodeSourceContentProcessor(identifiers),
    sourceFiles: new LocalSourceFileStorage(temporaryDirectory),
  })
  souls = new SoulApplicationService({
    content: repository,
    souls: repository,
    identifiers,
    clock,
    tokenCounter: new ConservativeTokenCounter(),
    tokenBudgets: { world: 2_500, persona: 3_500 },
  })
  learning = new LearningApplicationService({
    content: repository,
    learning: new SqliteLearningRepository(database.getClient()),
    identifiers,
    clock,
  })
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('成长与记忆事实管理闭环', () => {
  it('迁移建立统一成长、处理记录和记忆修订表', () => {
    const tables = database.getClient().prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'persona_feedback_sources', 'growth_records', 'growth_revisions',
        'persona_operation_records', 'memory_records', 'memory_revisions'
      ) ORDER BY name
    `).all()
    expect(tables).toEqual([
      { name: 'growth_records' },
      { name: 'growth_revisions' },
      { name: 'memory_records' },
      { name: 'memory_revisions' },
      { name: 'persona_feedback_sources' },
      { name: 'persona_operation_records' },
    ])
  })

  it('世界资料可批量启停，成长候选必须人工确认后生效', async () => {
    const world = await content.createWorld({
      name: '测试世界', summary: '',
      snapshot: { promptText: '基础规则' },
      changeSummary: '建立世界',
    })
    const source = await content.createPastedSource({ name: '世界资料', role: 'canon_fact', content: '城邦依水而建。' })
    await content.linkSource(source.source.id, { targetType: 'world', targetId: world.world.id, priority: 10 })

    const initial = await learning.getWorldGrowthWorkspace(world.world.id)
    expect(initial.sources).toEqual([expect.objectContaining({ id: source.source.id, isEnabled: true })])
    await learning.updateWorldSourceStates(world.world.id, { ids: [source.source.id], isEnabled: false })
    expect((await learning.getWorldGrowthWorkspace(world.world.id)).sources[0]?.isEnabled).toBe(false)

    const created = await learning.createGrowth('world', world.world.id, {
      content: '重要城邦通常依赖水运。', scope: '涉及城邦交通时', importance: 4, sourceIds: [source.source.id],
    })
    expect(created.growth).toEqual([expect.objectContaining({ status: 'candidate', evidenceCount: 1 })])
    await learning.updateGrowthStates('world', world.world.id, { ids: [created.growth[0]!.id], status: 'active' })
    expect((await learning.getWorldGrowthWorkspace(world.world.id)).growth[0]?.status).toBe('active')
  })

  it('人物反馈资料按条管理，删除来源不删除已确认成长', async () => {
    const persona = await createPersona()
    const feedback = await learning.createPersonaFeedbackSource(persona.id, {
      title: '表达反馈', content: '减少夸张修辞，结论先行。', sourceType: 'manual', sourceId: null,
    })
    const workspace = await learning.createGrowth('persona', persona.id, {
      content: '表达时先给结论并减少夸张修辞。', scope: '写作任务', importance: 5, sourceIds: [feedback.id],
    })
    const growthId = workspace.growth[0]!.id
    await learning.updateGrowthStates('persona', persona.id, { ids: [growthId], status: 'active' })
    await learning.deletePersonaFeedbackSources(persona.id, { ids: [feedback.id] })

    const afterDelete = await learning.getPersonaGrowthWorkspace(persona.id)
    expect(afterDelete.feedbackSources).toEqual([])
    expect(afterDelete.growth).toEqual([expect.objectContaining({ id: growthId, status: 'active', evidenceCount: 1 })])
    expect(database.getClient().prepare(`SELECT source_available FROM growth_revision_evidence`).all()).toEqual([{ source_available: 0 }])
  })

  it('人物处理记录可禁用，记忆确认后可显式转为成长反馈资料', async () => {
    const persona = await createPersona()
    const version = await souls.publishDraft('persona', persona.id)
    const runId = '30000000-0000-4000-8000-000000000001'
    database.getClient().prepare(`
      INSERT INTO generation_runs (
        id, kind, persona_version_id, status, input_json, parameter_snapshot_json,
        model_snapshot_json, prompt_version, context_provider, created_at, updated_at, completed_at
      ) VALUES (?, 'interest_assessment', ?, 'succeeded', '{}', '{}', '{}', 'test', 'sqlite_fts5', 10000, 10000, 10000)
    `).run(runId, version.id)
    const operationId = '30000000-0000-4000-8000-000000000002'
    database.getClient().prepare(`
      INSERT INTO persona_operation_records (
        id, persona_id, run_id, operation_type, result_summary, is_enabled,
        context_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'interest_assessment', '连续选择事实型文章', 1, '{}', 10000, 10000)
    `).run(operationId, persona.id, runId)
    const memoryId = '30000000-0000-4000-8000-000000000003'
    const revisionId = '30000000-0000-4000-8000-000000000004'
    const memoryContent = '更关注证据充分的事实型内容。'
    database.getClient().prepare(`
      INSERT INTO memory_records (id, persona_id, current_revision_id, memory_type, status, created_at, updated_at)
      VALUES (?, ?, ?, 'interest', 'candidate', 10000, 10000)
    `).run(memoryId, persona.id, revisionId)
    database.getClient().prepare(`
      INSERT INTO memory_revisions (
        id, memory_id, revision_no, content, content_hash, scope, importance,
        independent_evidence_count, created_by, created_at
      ) VALUES (?, ?, 1, ?, ?, '内容选择', 4, 2, 'analysis', 10000)
    `).run(revisionId, memoryId, memoryContent, createHash('sha256').update(memoryContent).digest('hex'))

    await learning.updateOperationRecordStates(persona.id, { ids: [operationId], isEnabled: false })
    await learning.updateMemoryStates(persona.id, { ids: [memoryId], status: 'active' })
    const converted = await learning.convertMemoryToFeedbackSource(persona.id, memoryId)

    expect((await learning.getPersonaMemoryWorkspace(persona.id)).operationRecords[0]?.isEnabled).toBe(false)
    expect(converted).toMatchObject({ sourceType: 'memory_conversion', sourceId: memoryId, content: memoryContent })
  })
})

/** @returns 新建但尚未发布灵魂的测试人物摘要。 */
async function createPersona(): Promise<{ id: string }> {
  const created = await content.createPersona({
    name: '测试人物', origin: 'original', worldId: null, sourceIds: [],
    snapshot: {
      promptText: '重视事实。',
    },
    changeSummary: '建立人物',
  })
  return { id: created.persona.id }
}
