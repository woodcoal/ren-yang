import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
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

/** 为学习闭环测试提供单调递增时间。 */
class TestClock implements Clock {
  /** 当前测试时间。 */
  private timestamp = 10_000

  /** @returns 下一毫秒 Unix 时间。 */
  now(): number {
    this.timestamp += 1
    return this.timestamp
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
  const clock = new TestClock()
  const tokenCounter = new ConservativeTokenCounter()
  const repository = new SqliteContentRepository(database.getClient())
  content = new ContentApplicationService({
    repository,
    souls: repository,
    identifiers,
    clock,
    tokenCounter,
    tokenBudgets: { world: 2_500, persona: 3_500 },
    sourceProcessor: new NodeSourceContentProcessor(identifiers),
    sourceFiles: new LocalSourceFileStorage(temporaryDirectory),
  })
  souls = new SoulApplicationService({
    content: repository,
    souls: repository,
    identifiers,
    clock,
    tokenCounter,
    tokenBudgets: { world: 2_500, persona: 3_500 },
  })
  learning = new LearningApplicationService({
    content: repository,
    learning: new SqliteLearningRepository(database.getClient()),
    identifiers,
    clock,
    tokenCounter,
    promptTokenBudgets: { world_growth: 2_500, persona_growth: 2_500, persona_memory: 3_000 },
  })
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('成长素材与学习提示词闭环', () => {
  it('迁移建立素材池、提示词草稿、版本和历史任务评分字段', () => {
    const tables = database.getClient().prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'growth_materials', 'learning_prompts', 'learning_prompt_drafts',
        'learning_prompt_versions', 'persona_external_records', 'persona_operation_records'
      ) ORDER BY name
    `).all()
    expect(tables).toEqual([
      { name: 'growth_materials' },
      { name: 'learning_prompt_drafts' },
      { name: 'learning_prompt_versions' },
      { name: 'learning_prompts' },
      { name: 'persona_external_records' },
      { name: 'persona_operation_records' },
    ])
    const operationColumns = database.getClient().prepare(`PRAGMA table_info(persona_operation_records)`).all() as Array<{ name: string }>
    expect(operationColumns.map(column => column.name)).toContain('importance')
  })

  it('世界资料可按评分导入固定素材快照，并明确提醒来源变化和支持刷新删除', async () => {
    const world = await createWorld()
    const source = await content.createPastedSource({ name: '水运资料', role: 'canon_fact', content: '城邦依水而建。' })
    await content.linkSource(source.source.id, { targetType: 'world', targetId: world.id, priority: 10 })

    expect(await learning.getWorldGrowthWorkspace(world.id)).toMatchObject({
      sources: [expect.objectContaining({ id: source.source.id, isImported: false })],
      materials: [],
    })
    const imported = await learning.importGrowthSources('world', world.id, {
      items: [{ sourceId: source.source.id, importance: 5 }],
    })
    expect(imported).toMatchObject({
      sources: [expect.objectContaining({ id: source.source.id, isImported: true })],
      materials: [expect.objectContaining({
        title: '水运资料', content: '城邦依水而建。', sourceType: 'source_material',
        sourceId: source.source.id, sourceState: 'current', importance: 5, isEnabled: true,
      })],
    })

    await content.updateSource(source.source.id, { name: '水运资料新版', role: 'canon_fact', content: '城邦依赖稳定河道运输。' })
    expect((await learning.getWorldGrowthWorkspace(world.id)).materials[0]?.sourceState).toBe('changed')

    const refreshed = await learning.importGrowthSources('world', world.id, {
      items: [{ sourceId: source.source.id, importance: 4 }],
    })
    expect(refreshed.materials).toEqual([expect.objectContaining({
      title: '水运资料新版', content: '城邦依赖稳定河道运输。', sourceState: 'current', importance: 4,
    })])
    const materialId = refreshed.materials[0]!.id
    await content.unlinkSource(source.source.id, `world:${world.id}`)
    expect((await learning.getWorldGrowthWorkspace(world.id)).materials[0]?.sourceState).toBe('missing')
    await learning.updateGrowthMaterialStates('world', world.id, { ids: [materialId], isEnabled: false })
    expect((await learning.getWorldGrowthWorkspace(world.id)).materials[0]?.isEnabled).toBe(false)
    expect((await learning.deleteGrowthMaterials('world', world.id, { ids: [materialId] })).materials).toEqual([])
    expect((await learning.getWorldGrowthWorkspace(world.id)).sources).toEqual([])
  })

  it('手工成长文档只进入人物素材池，并支持完整修改', async () => {
    const persona = await createPersona()
    const created = await learning.createGrowthMaterial('persona', persona.id, {
      title: '表达校准', content: '重要结论放在开头。', importance: 4,
    })
    expect(created.sources).toEqual([])
    expect(created.materials).toEqual([expect.objectContaining({
      title: '表达校准', content: '重要结论放在开头。', sourceType: 'manual',
      sourceId: null, sourceState: 'not_applicable', importance: 4,
    })])

    const materialId = created.materials[0]!.id
    const updated = await learning.updateGrowthMaterial('persona', persona.id, materialId, {
      title: '表达经验', content: '先给结论，再按证据强弱展开。', importance: 5,
    })
    expect(updated.materials[0]).toMatchObject({
      id: materialId, title: '表达经验', content: '先给结论，再按证据强弱展开。', importance: 5,
    })
    expect((await content.getPersona(persona.id)).sources).toEqual([])
  })

  it('学习提示词必须经过草稿发布才生效，并以新版本方式回退历史', async () => {
    const persona = await createPersona()
    const firstDraft = await learning.saveLearningPromptDraft('persona_growth', persona.id, {
      promptText: '回答时先给清晰结论。', baseVersionId: null,
    })
    expect(firstDraft).toMatchObject({ activeVersion: null, draft: { promptText: '回答时先给清晰结论。' } })

    const firstVersion = await learning.publishLearningPromptDraft('persona_growth', persona.id, { changeSummary: '建立人物成长提示词' })
    expect(firstVersion).toMatchObject({ versionNo: 1, parentVersionId: null, promptText: '回答时先给清晰结论。' })
    expect((await learning.getPersonaGrowthWorkspace(persona.id)).prompt).toMatchObject({
      activeVersion: { id: firstVersion.id }, draft: null,
    })

    await learning.saveLearningPromptDraft('persona_growth', persona.id, {
      promptText: '回答时先给结论，并标出未知信息。', baseVersionId: firstVersion.id,
    })
    const secondVersion = await learning.publishLearningPromptDraft('persona_growth', persona.id, { changeSummary: '补充不确定性表达' })
    expect(secondVersion).toMatchObject({ versionNo: 2, parentVersionId: firstVersion.id })

    const rollbackDraft = await learning.createLearningPromptDraftFromVersion('persona_growth', persona.id, { versionId: firstVersion.id })
    expect(rollbackDraft.draft).toMatchObject({ baseVersionId: firstVersion.id, promptText: firstVersion.promptText })
    const rollbackVersion = await learning.publishLearningPromptDraft('persona_growth', persona.id, { changeSummary: '回退到第一版内容' })
    expect(rollbackVersion).toMatchObject({ versionNo: 3, parentVersionId: firstVersion.id, promptText: firstVersion.promptText })
    expect((await learning.getPersonaGrowthWorkspace(persona.id)).prompt.versions.map(version => version.versionNo)).toEqual([3, 2, 1])
  })

  it('历史任务可分页使用的事实包含输入结果正文，并支持启停和逐条评分', async () => {
    const persona = await createPersona()
    const version = await souls.publishDraft('persona', persona.id)
    const runId = '30000000-0000-4000-8000-000000000001'
    database.getClient().prepare(`
      INSERT INTO generation_runs (
        id, kind, persona_version_id, status, input_json, parameter_snapshot_json,
        model_snapshot_json, prompt_version, context_provider, result_json, created_at, updated_at, completed_at
      ) VALUES (?, 'interest_assessment', ?, 'succeeded', ?, '{}', '{}', 'test', 'sqlite_fts5', ?, 10000, 10000, 10000)
    `).run(runId, version.id, JSON.stringify({ content: '是否阅读事实型文章？' }), JSON.stringify({ decision: 'interested' }))
    const operationId = '30000000-0000-4000-8000-000000000002'
    database.getClient().prepare(`
      INSERT INTO persona_operation_records (
        id, persona_id, run_id, operation_type, result_summary, is_enabled, importance,
        context_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'interest_assessment', '选择阅读事实型文章', 1, 3, '{}', 10000, 10000)
    `).run(operationId, persona.id, runId)

    const initial = await learning.getPersonaMemoryWorkspace(persona.id)
    expect(initial.operationRecords[0]).toMatchObject({
      id: operationId, title: '兴趣判断任务', importance: 3, isEnabled: true,
      content: expect.stringContaining('是否阅读事实型文章？'),
    })
    await learning.updateOperationRecordImportance(persona.id, operationId, { importance: 5 })
    await learning.updateOperationRecordStates(persona.id, { ids: [operationId], isEnabled: false })
    expect((await learning.getPersonaMemoryWorkspace(persona.id)).operationRecords[0]).toMatchObject({ importance: 5, isEnabled: false })
  })

  it('第三方经历记录可追溯来源并支持修改、批量启停和删除', async () => {
    const persona = await createPersona()
    const created = await learning.createExternalRecord(persona.id, {
      occurredOn: '2026-08-30',
      content: '为小说项目整理了人物关系。',
      references: [{ name: '创作笔记', address: '笔记库/小说项目/人物关系' }],
      importance: 4,
    })
    expect(created.externalRecords).toEqual([expect.objectContaining({
      occurredOn: '2026-08-30', content: '为小说项目整理了人物关系。',
      references: [{ name: '创作笔记', address: '笔记库/小说项目/人物关系' }],
      analysisContent: expect.stringContaining('创作笔记：笔记库/小说项目/人物关系'),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), importance: 4, isEnabled: true,
    })])

    const recordId = created.externalRecords[0]!.id
    const updated = await learning.updateExternalRecord(persona.id, recordId, {
      occurredOn: '2026-08-31', content: '完成了人物关系校对。',
      references: [{ name: '小说原稿', address: '第三章' }], importance: 5,
    })
    expect(updated.externalRecords[0]).toMatchObject({
      id: recordId, occurredOn: '2026-08-31', content: '完成了人物关系校对。', importance: 5,
    })
    expect((await learning.updateExternalRecordStates(persona.id, {
      ids: [recordId], isEnabled: false,
    })).externalRecords[0]?.isEnabled).toBe(false)
    expect((await learning.deleteExternalRecords(persona.id, { ids: [recordId] })).externalRecords).toEqual([])
  })
})

/** @returns 新建并保存灵魂草稿的测试人物摘要。 */
async function createPersona(): Promise<{ id: string }> {
  const created = await content.createPersona({
    name: '测试人物', worldId: null, sourceIds: [],
    snapshot: { promptText: '重视事实。' },
    changeSummary: '建立人物',
  })
  return { id: created.persona.id }
}

/** @returns 新建并保存灵魂草稿的测试世界摘要。 */
async function createWorld(): Promise<{ id: string }> {
  const created = await content.createWorld({
    name: '测试世界', summary: '', snapshot: { promptText: '基础规则。' }, changeSummary: '建立世界',
  })
  return { id: created.world.id }
}
