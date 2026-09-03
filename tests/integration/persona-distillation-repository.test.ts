import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteDistillationRepository } from '../../server/infrastructure/database/SqliteDistillationRepository'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'

let directory: string
let database: SqliteDatabase
let repository: SqliteDistillationRepository

/** 人物自由蒸馏持久化测试使用的稳定标识。 */
const IDS = {
  run: '10000000-0000-4000-8000-000000000001',
  task: '10000000-0000-4000-8000-000000000002',
  requirementInput: '10000000-0000-4000-8000-000000000003',
  source: '10000000-0000-4000-8000-000000000004',
  sourceInput: '10000000-0000-4000-8000-000000000005',
  persona: '10000000-0000-4000-8000-000000000006',
  soulVersion: '10000000-0000-4000-8000-000000000007',
  retryRun: '10000000-0000-4000-8000-000000000008',
  retryTask: '10000000-0000-4000-8000-000000000009',
  retryInput: '10000000-0000-4000-8000-000000000010',
} as const

/** 创建只含用户要求的自由蒸馏运行。 */
async function createRun(): Promise<void> {
  await repository.createRun({
    id: IDS.run,
    taskId: IDS.task,
    retryOfRunId: null,
    mode: 'create',
    createdPersonaId: null,
    baseSoulVersionId: null,
    requestedName: '顾岚',
    objective: '提炼判断方式。',
    worldId: null,
    provider: 'sqlite_fts5',
    algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 2 },
    inputs: [{
      id: IDS.requirementInput,
      inputType: 'user_statement',
      sourceId: null,
      name: '用户创建要求',
      sourceRole: null,
      independentSourceKey: 'user-requirement',
      contentHash: 'a'.repeat(64),
      contentSnapshot: '提炼判断方式。',
      originUrl: null,
      authorName: null,
      publishedAt: null,
    }],
    timestamp: 2_000,
  })
}

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-freeform-distillation-repository-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  repository = new SqliteDistillationRepository(database.getClient())
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('人物自由蒸馏 SQLite 持久化', () => {
  it('迁移只保留运行与输入表，并注册单次自由分析提示词', () => {
    const client = database.getClient()
    expect(client.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'persona_distillation_%' ORDER BY name
    `).all()).toEqual([
      { name: 'persona_distillation_inputs' },
      { name: 'persona_distillation_runs' },
    ])
    expect(client.prepare(`SELECT code FROM ai_prompts WHERE code LIKE 'distillation.%'`).all())
      .toEqual([{ code: 'distillation.analyze_persona' }])
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('原子创建运行、不可变输入快照和唯一自由分析任务', async () => {
    const client = database.getClient()
    client.prepare(`
      INSERT INTO source_materials (
        id, name, role, input_type, content_hash, content_text, original_file_path,
        origin_url, author_name, published_at, original_source_key, created_at, updated_at
      ) VALUES (?, '访谈', 'reference', 'paste', ?, '原始访谈正文。', NULL,
        'https://example.com/interview', '受访者', 1700000000000, 'interview-one', 1000, 1000)
    `).run(IDS.source, 'b'.repeat(64))
    await repository.createRun({
      id: IDS.run,
      taskId: IDS.task,
      retryOfRunId: null,
      mode: 'create',
      createdPersonaId: null,
      baseSoulVersionId: null,
      requestedName: '顾岚',
      objective: '提炼重视证据的判断方式。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 2 },
      inputs: [
        {
          id: IDS.requirementInput, inputType: 'user_statement', sourceId: null, name: '用户创建要求', sourceRole: null,
          independentSourceKey: 'user-requirement', contentHash: 'a'.repeat(64), contentSnapshot: '提炼重视证据的判断方式。',
          originUrl: null, authorName: null, publishedAt: null,
        },
        {
          id: IDS.sourceInput, inputType: 'source_material', sourceId: IDS.source, name: '访谈', sourceRole: 'reference',
          independentSourceKey: 'interview-one', contentHash: 'b'.repeat(64), contentSnapshot: '原始访谈正文。',
          originUrl: 'https://example.com/interview', authorName: '受访者', publishedAt: 1_700_000_000_000,
        },
      ],
      timestamp: 2_000,
    })
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'analyzing',
      inputs: [
        { id: IDS.requirementInput, inputType: 'user_statement' },
        { id: IDS.sourceInput, sourceId: IDS.source, contentSnapshot: '原始访谈正文。' },
      ],
    })
    expect(client.prepare('SELECT payload_json, status FROM task_jobs WHERE id = ?').get(IDS.task)).toEqual({
      payload_json: JSON.stringify({ distillationRunId: IDS.run, phase: 'analyze' }), status: 'queued',
    })
    client.prepare(`UPDATE source_materials SET content_text = '后来修改的正文。' WHERE id = ?`).run(IDS.source)
    expect((await repository.findRun(IDS.run))?.inputs[1]?.contentSnapshot).toBe('原始访谈正文。')
  })

  it('一次保存分析报告和候选，人工校准不再创建新的模型任务', async () => {
    await createRun()
    const firstHash = 'd'.repeat(64)
    await expect(repository.saveAnalysis({
      runId: IDS.run,
      rawResult: { analysisReport: '分析', name: '顾岚', promptText: '第一版候选。' },
      analysisReport: '## 判断方式\n先明确判断依据。',
      candidateName: '顾岚',
      candidatePromptText: '第一版候选。',
      candidatePromptHash: firstHash,
      timestamp: 3_000,
    })).resolves.toBe(true)
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'awaiting_candidate_review',
      analysisReport: '## 判断方式\n先明确判断依据。',
      candidatePromptHash: firstHash,
      preparedPromptHash: firstHash,
    })
    const taskCount = database.getClient().prepare(`SELECT COUNT(*) AS count FROM task_jobs WHERE type = 'distill_persona'`).get() as { count: number }
    const secondHash = 'e'.repeat(64)
    await expect(repository.saveCandidate({
      runId: IDS.run, expectedUpdatedAt: 3_000, candidatePromptText: '人工校准后的候选。', candidatePromptHash: secondHash, timestamp: 4_000,
    })).resolves.toBe(true)
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'awaiting_candidate_review', candidatePromptHash: secondHash, preparedPromptHash: secondHash,
    })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM task_jobs WHERE type = 'distill_persona'`).get()).toEqual(taskCount)
  })

  it('最终确认原子创建人物、初始当前灵魂版本并完成蒸馏运行', async () => {
    await createRun()
    const promptHash = 'd'.repeat(64)
    await repository.saveAnalysis({
      runId: IDS.run, rawResult: {}, analysisReport: '人物分析报告。', candidateName: '顾岚',
      candidatePromptText: '# 心智模型\n先明确判断依据。', candidatePromptHash: promptHash, timestamp: 3_000,
    })
    await expect(repository.confirmCandidate({
      runId: IDS.run, expectedUpdatedAt: 3_000, expectedPromptHash: promptHash, personaId: IDS.persona,
      soulVersionId: IDS.soulVersion, name: '顾岚', runtimeTokenCount: 18, tokenCounter: '测试计数器', timestamp: 4_000,
    })).resolves.toBe(true)
    expect(database.getClient().prepare(`SELECT name, active_soul_version_id FROM personas WHERE id = ?`).get(IDS.persona))
      .toEqual({ name: '顾岚', active_soul_version_id: IDS.soulVersion })
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'completed', createdPersonaId: IDS.persona, reviewedPromptText: '# 心智模型\n先明确判断依据。',
    })
  })

  it('失败运行可按固定输入和算法快照重试一次自由分析', async () => {
    await createRun()
    await repository.failRun(IDS.run, 'MODEL_OUTPUT_INVALID', '模型输出无效', 3_000)
    await expect(repository.createRetry({
      sourceRunId: IDS.run, runId: IDS.retryRun, taskId: IDS.retryTask, inputIds: [IDS.retryInput], timestamp: 4_000,
    })).resolves.toBe(true)
    expect(await repository.findRun(IDS.retryRun)).toMatchObject({
      retryOfRunId: IDS.run, status: 'analyzing', inputs: [{ id: IDS.retryInput, contentSnapshot: '提炼判断方式。' }],
    })
    expect(database.getClient().prepare('SELECT payload_json, status FROM task_jobs WHERE id = ?').get(IDS.retryTask)).toEqual({
      payload_json: JSON.stringify({ distillationRunId: IDS.retryRun, phase: 'analyze' }), status: 'queued',
    })
  })

  it('取消或租约耗尽时同步终止自由分析运行', async () => {
    await createRun()
    const tasks = new SqliteTaskJobRepository(database.getClient())
    await tasks.claimNext(3_000, 100)
    await repository.requestCancellation(IDS.run, 3_050)
    await tasks.recoverExpired(3_200)
    expect(await repository.findRun(IDS.run)).toMatchObject({ status: 'canceled', completedAt: 3_200 })
  })
})
