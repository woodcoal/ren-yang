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

/** 人物蒸馏持久化测试使用的稳定标识。 */
const IDS = {
  run: '10000000-0000-4000-8000-000000000001',
  task: '10000000-0000-4000-8000-000000000002',
  requirementInput: '10000000-0000-4000-8000-000000000003',
  source: '10000000-0000-4000-8000-000000000004',
  sourceInput: '10000000-0000-4000-8000-000000000005',
  extractTask: '10000000-0000-4000-8000-000000000006',
  claim: '10000000-0000-4000-8000-000000000007',
  evidence: '10000000-0000-4000-8000-000000000008',
  evaluation: '10000000-0000-4000-8000-000000000009',
  reevaluationTask: '10000000-0000-4000-8000-000000000010',
  persona: '10000000-0000-4000-8000-000000000011',
  soulVersion: '10000000-0000-4000-8000-000000000012',
  retryRun: '10000000-0000-4000-8000-000000000013',
  retryTask: '10000000-0000-4000-8000-000000000014',
  retryInput: '10000000-0000-4000-8000-000000000015',
  otherRun: '10000000-0000-4000-8000-000000000016',
  otherTask: '10000000-0000-4000-8000-000000000017',
  otherInput: '10000000-0000-4000-8000-000000000018',
} as const

/**
 * 创建只包含用户明确要求且已经确认资料范围的蒸馏运行。
 * @returns 运行进入认知提取状态时结束。
 */
async function createConfirmedRequirementRun(): Promise<void> {
  await repository.createRun({
    id: IDS.run,
    taskId: IDS.task,
    retryOfRunId: null,
    requestedName: '顾岚',
    objective: '提炼判断方式。',
    worldId: null,
    provider: 'sqlite_fts5',
    algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
    inputs: [{
      id: IDS.requirementInput,
      inputType: 'user_statement',
      sourceId: null,
      name: '用户创建要求',
      sourceRole: null,
      sourceRelation: 'user_statement',
      coverageDimensions: [],
      independentSourceKey: 'user-requirement',
      contentHash: 'a'.repeat(64),
      contentSnapshot: '提炼判断方式。',
      originUrl: null,
      authorName: null,
      publishedAt: null,
    }],
    timestamp: 2_000,
  })
  await repository.saveSourceAssessment({
    runId: IDS.run,
    assessment: { sources: [] },
    coverage: {
      sourceCount: 0,
      independentSourceCount: 0,
      directIndependentSourceCount: 0,
      duplicateSourceCount: 0,
      dimensionIndependentSourceCounts: {
        writings: 0,
        conversations: 0,
        expression: 0,
        external_views: 0,
        decisions: 0,
        timeline: 0,
      },
      warnings: ['没有选择资料，人物候选只能依据用户明确要求形成。'],
    },
    timestamp: 3_000,
  })
  await repository.confirmSources({
    runId: IDS.run,
    expectedUpdatedAt: 3_000,
    acceptedInputIds: [],
    corrections: [],
    taskId: IDS.extractTask,
    timestamp: 4_000,
  })
}

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-persona-distillation-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  repository = new SqliteDistillationRepository(database.getClient())
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('人物蒸馏 SQLite 持久化', () => {
  it('迁移建立蒸馏运行、输入、候选、证据和评测表，并扩展资料来源元数据', () => {
    const client = database.getClient()
    const tables = client.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'persona_distillation_%'
      ORDER BY name
    `).all()

    expect(tables).toEqual([
      { name: 'persona_distillation_claims' },
      { name: 'persona_distillation_evaluations' },
      { name: 'persona_distillation_evidence' },
      { name: 'persona_distillation_inputs' },
      { name: 'persona_distillation_runs' },
    ])
    expect(client.prepare(`PRAGMA table_info(source_materials)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'origin_url', notnull: 0 }),
      expect.objectContaining({ name: 'author_name', notnull: 0 }),
      expect.objectContaining({ name: 'published_at', notnull: 0 }),
      expect.objectContaining({ name: 'original_source_key', notnull: 0 }),
    ]))
    expect(client.prepare(`SELECT COUNT(*) AS count, MAX(created_at) AS version FROM __drizzle_migrations`).get())
      .toEqual({ count: 19, version: 1790841600000 })
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('原子创建运行、不可变输入快照和首个资料评估任务', async () => {
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
      requestedName: '顾岚',
      objective: '提炼重视证据的判断方式。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
      inputs: [
        {
          id: IDS.requirementInput,
          inputType: 'user_statement',
          sourceId: null,
          name: '用户创建要求',
          sourceRole: null,
          sourceRelation: 'user_statement',
          coverageDimensions: [],
          independentSourceKey: 'user-requirement',
          contentHash: 'a'.repeat(64),
          contentSnapshot: '提炼重视证据的判断方式。',
          originUrl: null,
          authorName: null,
          publishedAt: null,
        },
        {
          id: IDS.sourceInput,
          inputType: 'source_material',
          sourceId: IDS.source,
          name: '访谈',
          sourceRole: 'reference',
          sourceRelation: null,
          coverageDimensions: [],
          independentSourceKey: 'interview-one',
          contentHash: 'b'.repeat(64),
          contentSnapshot: '原始访谈正文。',
          originUrl: 'https://example.com/interview',
          authorName: '受访者',
          publishedAt: 1_700_000_000_000,
        },
      ],
      timestamp: 2_000,
    })

    const run = await repository.findRun(IDS.run)
    expect(run).toMatchObject({
      id: IDS.run,
      status: 'assessing_sources',
      requestedName: '顾岚',
      provider: 'sqlite_fts5',
      inputs: [
        { id: IDS.requirementInput, inputType: 'user_statement', sourceRelation: 'user_statement' },
        { id: IDS.sourceInput, inputType: 'source_material', sourceId: IDS.source, contentSnapshot: '原始访谈正文。' },
      ],
    })
    expect(client.prepare(`SELECT run_id, type, payload_json, status FROM task_jobs WHERE id = ?`).get(IDS.task)).toEqual({
      run_id: null,
      type: 'distill_persona',
      payload_json: JSON.stringify({ distillationRunId: IDS.run, phase: 'assess_sources' }),
      status: 'queued',
    })
    client.prepare(`UPDATE source_materials SET content_text = '后来修改的正文。' WHERE id = ?`).run(IDS.source)
    expect((await repository.findRun(IDS.run))?.inputs[1]?.contentSnapshot).toBe('原始访谈正文。')
    client.prepare(`DELETE FROM source_materials WHERE id = ?`).run(IDS.source)
    expect((await repository.findRun(IDS.run))?.inputs[1]).toMatchObject({
      sourceId: null,
      contentSnapshot: null,
      sourceAvailable: false,
    })
  })

  it('保存覆盖快照后等待人工确认，并以状态和时间条件原子排入提取任务', async () => {
    await repository.createRun({
      id: IDS.run,
      taskId: IDS.task,
      retryOfRunId: null,
      requestedName: '顾岚',
      objective: '提炼判断方式。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
      inputs: [{
        id: IDS.requirementInput,
        inputType: 'user_statement',
        sourceId: null,
        name: '用户创建要求',
        sourceRole: null,
        sourceRelation: 'user_statement',
        coverageDimensions: [],
        independentSourceKey: 'user-requirement',
        contentHash: 'a'.repeat(64),
        contentSnapshot: '提炼判断方式。',
        originUrl: null,
        authorName: null,
        publishedAt: null,
      }],
      timestamp: 2_000,
    })
    const coverage = {
      sourceCount: 0,
      independentSourceCount: 0,
      directIndependentSourceCount: 0,
      duplicateSourceCount: 0,
      dimensionIndependentSourceCounts: {
        writings: 0,
        conversations: 0,
        expression: 0,
        external_views: 0,
        decisions: 0,
        timeline: 0,
      },
      warnings: ['没有选择资料，人物候选只能依据用户明确要求形成。'],
    }

    await expect(repository.saveSourceAssessment({
      runId: IDS.run,
      assessment: { sources: [] },
      coverage,
      timestamp: 3_000,
    })).resolves.toBe(true)
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'awaiting_source_review',
      coverageSnapshot: coverage,
      updatedAt: 3_000,
    })
    await expect(repository.confirmSources({
      runId: IDS.run,
      expectedUpdatedAt: 3_000,
      acceptedInputIds: [],
      corrections: [],
      taskId: IDS.extractTask,
      timestamp: 4_000,
    })).resolves.toBe(true)
    expect(await repository.findRun(IDS.run)).toMatchObject({ status: 'extracting', updatedAt: 4_000 })
    expect(database.getClient().prepare(`SELECT type, payload_json, status FROM task_jobs WHERE id = ?`).get(IDS.extractTask)).toEqual({
      type: 'distill_persona',
      payload_json: JSON.stringify({ distillationRunId: IDS.run, phase: 'extract_claims' }),
      status: 'queued',
    })
    await expect(repository.confirmSources({
      runId: IDS.run,
      expectedUpdatedAt: 3_000,
      acceptedInputIds: [],
      corrections: [],
      taskId: '20000000-0000-4000-8000-000000000007',
      timestamp: 5_000,
    })).resolves.toBe(false)
  })

  it('按阶段保存提取候选、精确证据、灵魂正文和哈希绑定评测', async () => {
    await createConfirmedRequirementRun()
    const promptHash = 'd'.repeat(64)
    const claim = {
      id: IDS.claim,
      category: 'mental_model' as const,
      statement: '先明确判断依据。',
      applicability: '事实判断',
      limitations: '只有用户明确要求支持，不能冒充真实人物经历。',
      basis: 'explicit' as const,
      confidence: 0.9,
      independentSourceCount: 1,
      crossContextCount: 0,
      status: 'valid' as const,
      rejectionReasons: [],
      warnings: [],
      conflicts: [],
      evidence: [{
        id: IDS.evidence,
        inputId: IDS.requirementInput,
        relation: 'supporting' as const,
        quote: '提炼判断方式',
        quoteHash: 'c'.repeat(64),
      }],
    }

    await expect(repository.saveExtraction({
      runId: IDS.run,
      rawExtraction: { claims: [{ statement: claim.statement }] },
      claims: [claim],
      qualityGate: { hardFailures: [], softWarnings: [] },
      timestamp: 5_000,
    })).resolves.toBe(true)
    await expect(repository.saveSynthesis({
      runId: IDS.run,
      candidateName: '顾岚',
      candidatePromptText: '# 心智模型\n先明确判断依据。',
      candidatePromptHash: promptHash,
      timestamp: 6_000,
    })).resolves.toBe(true)
    await expect(repository.saveEvaluation({
      runId: IDS.run,
      candidatePromptHash: promptHash,
      evaluations: [{
        id: IDS.evaluation,
        roundNo: 1,
        evaluationType: 'unknown_boundary',
        input: { question: '未提供的经历是什么？' },
        expected: { mustExpressUnknown: true },
        output: { answer: '资料不足，无法确认。' },
        status: 'passed',
        score: 1,
        failureReasons: [],
      }],
      hardFailures: [],
      timestamp: 7_000,
    })).resolves.toBe(true)

    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'awaiting_candidate_review',
      candidateName: '顾岚',
      candidatePromptHash: promptHash,
      evaluatedPromptHash: promptHash,
      claims: [{
        id: IDS.claim,
        statement: '先明确判断依据。',
        evidence: [{ id: IDS.evidence, inputId: IDS.requirementInput, quoteHash: 'c'.repeat(64) }],
      }],
      evaluations: [{
        id: IDS.evaluation,
        roundNo: 1,
        evaluationType: 'unknown_boundary',
        status: 'passed',
      }],
    })
  })

  it('候选编辑会清除旧评测哈希并原子排入重新评测任务', async () => {
    await createConfirmedRequirementRun()
    const firstHash = 'd'.repeat(64)
    await repository.saveExtraction({
      runId: IDS.run,
      rawExtraction: { claims: [] },
      claims: [],
      qualityGate: { hardFailures: [], softWarnings: [] },
      timestamp: 5_000,
    })
    await repository.saveSynthesis({
      runId: IDS.run,
      candidateName: '顾岚',
      candidatePromptText: '第一版候选。',
      candidatePromptHash: firstHash,
      timestamp: 6_000,
    })
    await repository.saveEvaluation({
      runId: IDS.run,
      candidatePromptHash: firstHash,
      evaluations: [],
      hardFailures: [],
      timestamp: 7_000,
    })
    const secondHash = 'e'.repeat(64)

    await expect(repository.saveCandidateForEvaluation({
      runId: IDS.run,
      expectedUpdatedAt: 7_000,
      candidatePromptText: '第二版候选。',
      candidatePromptHash: secondHash,
      taskId: IDS.reevaluationTask,
      timestamp: 8_000,
    })).resolves.toBe(true)
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'evaluating',
      candidatePromptText: '第二版候选。',
      candidatePromptHash: secondHash,
      evaluatedPromptHash: null,
      updatedAt: 8_000,
    })
    expect(database.getClient().prepare(`SELECT payload_json, status FROM task_jobs WHERE id = ?`).get(IDS.reevaluationTask)).toEqual({
      payload_json: JSON.stringify({ distillationRunId: IDS.run, phase: 'evaluate_soul' }),
      status: 'queued',
    })
    await expect(repository.saveCandidateForEvaluation({
      runId: IDS.run,
      expectedUpdatedAt: 7_000,
      candidatePromptText: '第三版候选。',
      candidatePromptHash: 'f'.repeat(64),
      taskId: '20000000-0000-4000-8000-000000000011',
      timestamp: 9_000,
    })).resolves.toBe(false)
  })

  it('业务 Worker 可以领取蒸馏任务，并在取消租约到期后同步终止运行', async () => {
    await repository.createRun({
      id: IDS.run,
      taskId: IDS.task,
      retryOfRunId: null,
      requestedName: '顾岚',
      objective: '提炼判断方式。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
      inputs: [{
        id: IDS.requirementInput,
        inputType: 'user_statement',
        sourceId: null,
        name: '用户创建要求',
        sourceRole: null,
        sourceRelation: 'user_statement',
        coverageDimensions: [],
        independentSourceKey: 'user-requirement',
        contentHash: 'a'.repeat(64),
        contentSnapshot: '提炼判断方式。',
        originUrl: null,
        authorName: null,
        publishedAt: null,
      }],
      timestamp: 2_000,
    })
    const tasks = new SqliteTaskJobRepository(database.getClient())
    await expect(tasks.claimNext(3_000, 100)).resolves.toMatchObject({
      id: IDS.task,
      type: 'distill_persona',
      status: 'running',
    })
    await expect(repository.requestCancellation(IDS.run, 3_050)).resolves.toBe(true)
    expect(database.getClient().prepare(`SELECT status FROM task_jobs WHERE id = ?`).get(IDS.task))
      .toEqual({ status: 'cancel_requested' })
    await expect(tasks.recoverExpired(3_200)).resolves.toBe(1)
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'canceled',
      updatedAt: 3_200,
      completedAt: 3_200,
    })
  })

  it('蒸馏任务租约耗尽时同步终止业务运行', async () => {
    await repository.createRun({
      id: IDS.run,
      taskId: IDS.task,
      retryOfRunId: null,
      requestedName: '顾岚',
      objective: '提炼判断方式。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
      inputs: [{
        id: IDS.requirementInput,
        inputType: 'user_statement',
        sourceId: null,
        name: '用户创建要求',
        sourceRole: null,
        sourceRelation: 'user_statement',
        coverageDimensions: [],
        independentSourceKey: 'user-requirement',
        contentHash: 'a'.repeat(64),
        contentSnapshot: '提炼判断方式。',
        originUrl: null,
        authorName: null,
        publishedAt: null,
      }],
      timestamp: 2_000,
    })
    const client = database.getClient()
    client.prepare(`UPDATE task_jobs SET max_attempts = 1 WHERE id = ?`).run(IDS.task)
    const tasks = new SqliteTaskJobRepository(client)
    await tasks.claimNext(3_000, 100)

    await expect(tasks.recoverExpired(3_200)).resolves.toBe(1)
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'failed',
      errorCode: 'TASK_LEASE_EXHAUSTED',
      completedAt: 3_200,
    })
  })

  it('不可重试任务失败时同步终止人物蒸馏运行', async () => {
    await repository.createRun({
      id: IDS.run,
      taskId: IDS.task,
      retryOfRunId: null,
      requestedName: '顾岚',
      objective: '提炼判断方式。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
      inputs: [{
        id: IDS.requirementInput,
        inputType: 'user_statement',
        sourceId: null,
        name: '用户创建要求',
        sourceRole: null,
        sourceRelation: 'user_statement',
        coverageDimensions: [],
        independentSourceKey: 'user-requirement',
        contentHash: 'a'.repeat(64),
        contentSnapshot: '提炼判断方式。',
        originUrl: null,
        authorName: null,
        publishedAt: null,
      }],
      timestamp: 2_000,
    })
    const tasks = new SqliteTaskJobRepository(database.getClient())
    const task = await tasks.claimNext(3_000, 100)
    if (!task) throw new Error('人物蒸馏任务未被领取')

    await expect(tasks.markFailed(task.id, '不可重试错误', 3_050, false)).resolves.toBe(false)
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'failed',
      errorCode: 'TASK_EXECUTION_FAILED',
      errorMessage: '不可重试错误',
      completedAt: 3_050,
    })
  })

  it('最终确认原子创建人物、初始当前灵魂版本并完成蒸馏运行', async () => {
    await createConfirmedRequirementRun()
    const promptHash = 'd'.repeat(64)
    await repository.saveExtraction({
      runId: IDS.run,
      rawExtraction: { claims: [] },
      claims: [],
      qualityGate: { hardFailures: [], softWarnings: [] },
      timestamp: 5_000,
    })
    await repository.saveSynthesis({
      runId: IDS.run,
      candidateName: '顾岚',
      candidatePromptText: '# 心智模型\n先明确判断依据。',
      candidatePromptHash: promptHash,
      timestamp: 6_000,
    })
    await repository.saveEvaluation({
      runId: IDS.run,
      candidatePromptHash: promptHash,
      evaluations: [],
      hardFailures: [],
      timestamp: 7_000,
    })

    await expect(repository.confirmAndCreatePersona({
      runId: IDS.run,
      expectedUpdatedAt: 7_000,
      expectedPromptHash: promptHash,
      personaId: IDS.persona,
      soulVersionId: IDS.soulVersion,
      name: '顾岚',
      runtimeTokenCount: 18,
      tokenCounter: '测试计数器',
      timestamp: 8_000,
    })).resolves.toBe(true)
    expect(database.getClient().prepare(`
      SELECT name, active_soul_version_id, is_enabled FROM personas WHERE id = ?
    `).get(IDS.persona)).toEqual({
      name: '顾岚',
      active_soul_version_id: IDS.soulVersion,
      is_enabled: 1,
    })
    expect(database.getClient().prepare(`
      SELECT prompt_text, status, runtime_token_count, token_counter
      FROM soul_versions WHERE id = ?
    `).get(IDS.soulVersion)).toEqual({
      prompt_text: '# 心智模型\n先明确判断依据。',
      status: 'published',
      runtime_token_count: 18,
      token_counter: '测试计数器',
    })
    expect(await repository.findRun(IDS.run)).toMatchObject({
      status: 'completed',
      createdPersonaId: IDS.persona,
      reviewedPromptText: '# 心智模型\n先明确判断依据。',
      completedAt: 8_000,
    })
    await expect(repository.confirmAndCreatePersona({
      runId: IDS.run,
      expectedUpdatedAt: 7_000,
      expectedPromptHash: promptHash,
      personaId: '20000000-0000-4000-8000-000000000013',
      soulVersionId: '20000000-0000-4000-8000-000000000014',
      name: '重复人物',
      runtimeTokenCount: 18,
      tokenCounter: '测试计数器',
      timestamp: 9_000,
    })).resolves.toBe(false)
  })

  it('失败运行可以用原快照创建新的可追溯重试运行', async () => {
    await repository.createRun({
      id: IDS.run,
      taskId: IDS.task,
      retryOfRunId: null,
      requestedName: '顾岚',
      objective: '提炼判断方式。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
      inputs: [{
        id: IDS.requirementInput,
        inputType: 'user_statement',
        sourceId: null,
        name: '用户创建要求',
        sourceRole: null,
        sourceRelation: 'user_statement',
        coverageDimensions: [],
        independentSourceKey: 'user-requirement',
        contentHash: 'a'.repeat(64),
        contentSnapshot: '提炼判断方式。',
        originUrl: null,
        authorName: null,
        publishedAt: null,
      }],
      timestamp: 2_000,
    })
    await expect(repository.failRun(IDS.run, 'MODEL_OUTPUT_INVALID', '模型输出无效', 3_000)).resolves.toBe(true)

    await expect(repository.createRetry({
      sourceRunId: IDS.run,
      runId: IDS.retryRun,
      taskId: IDS.retryTask,
      inputIds: [IDS.retryInput],
      timestamp: 4_000,
    })).resolves.toBe(true)
    expect(await repository.findRun(IDS.retryRun)).toMatchObject({
      retryOfRunId: IDS.run,
      status: 'assessing_sources',
      requestedName: '顾岚',
      provider: 'sqlite_fts5',
      inputs: [{
        id: IDS.retryInput,
        inputType: 'user_statement',
        contentSnapshot: '提炼判断方式。',
      }],
    })
    expect(database.getClient().prepare(`SELECT payload_json, status FROM task_jobs WHERE id = ?`).get(IDS.retryTask)).toEqual({
      payload_json: JSON.stringify({ distillationRunId: IDS.retryRun, phase: 'assess_sources' }),
      status: 'queued',
    })
  })

  it('数据库拒绝候选引用其他蒸馏运行的输入', async () => {
    await createConfirmedRequirementRun()
    await repository.saveExtraction({
      runId: IDS.run,
      rawExtraction: { claims: [] },
      claims: [{
        id: IDS.claim,
        category: 'mental_model',
        statement: '先明确判断依据。',
        applicability: '事实判断',
        limitations: '不能冒充真实人物经历。',
        basis: 'explicit',
        confidence: 0.9,
        independentSourceCount: 1,
        crossContextCount: 0,
        status: 'valid',
        rejectionReasons: [],
        warnings: [],
        conflicts: [],
        evidence: [],
      }],
      qualityGate: { hardFailures: [], softWarnings: [] },
      timestamp: 5_000,
    })
    await repository.createRun({
      id: IDS.otherRun,
      taskId: IDS.otherTask,
      retryOfRunId: null,
      requestedName: '另一人物',
      objective: '另一项要求。',
      worldId: null,
      provider: 'sqlite_fts5',
      algorithmSnapshot: { algorithmCode: 'persona_distillation', implementationVersion: 1 },
      inputs: [{
        id: IDS.otherInput,
        inputType: 'user_statement',
        sourceId: null,
        name: '用户创建要求',
        sourceRole: null,
        sourceRelation: 'user_statement',
        coverageDimensions: [],
        independentSourceKey: 'other-requirement',
        contentHash: 'f'.repeat(64),
        contentSnapshot: '另一项要求。',
        originUrl: null,
        authorName: null,
        publishedAt: null,
      }],
      timestamp: 6_000,
    })

    expect(() => database.getClient().prepare(`
      INSERT INTO persona_distillation_evidence (
        id, claim_id, input_id, relation, quote, quote_hash, created_at
      ) VALUES ('cross-run-evidence', ?, ?, 'supporting', '另一项要求', ?, 7000)
    `).run(IDS.claim, IDS.otherInput, 'a'.repeat(64))).toThrow('evidence input belongs to another distillation run')
  })
})
