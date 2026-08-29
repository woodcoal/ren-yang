import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { FeedbackApplicationService } from '../../server/application/feedback/FeedbackApplicationService'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteFeedbackRepository } from '../../server/infrastructure/database/SqliteFeedbackRepository'
import type { Clock } from '../../server/ports/Clock'
import type { ContextSyncTaskQueue } from '../../server/ports/ContextSyncTaskQueue'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import type { PersonaSnapshot } from '../../shared/types/content'

/** 为测试提供单调递增且格式合法的 UUID。 */
class SequentialIdentifierGenerator implements IdentifierGenerator {
  /** 当前序号。 */
  private sequence = 100

  /** @returns 下一个可预测 UUID。 */
  create(): string {
    this.sequence += 1
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

/** 为测试提供可推进时钟。 */
class MutableClock implements Clock {
  /** 当前时间。 */
  public timestamp = 10_000

  /** @returns 当前 UTC Unix 毫秒。 */
  now(): number {
    this.timestamp += 1
    return this.timestamp
  }
}

/** 依次返回预设结构输出的固定文本模型。 */
class QueueTextModel implements TextModelPort {
  /** 模型调用记录。 */
  public readonly requests: TextModelRequest[] = []

  /**
   * 创建固定模型。
   * @param outputs 按调用顺序返回的结构对象。
   */
  constructor(private readonly outputs: unknown[]) {}

  /** @returns 固定非敏感模型快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible' as const, model: 'feedback-test-model', endpointOrigin: 'https://model.test' }
  }

  /** @param request 结构化请求。 @returns 下一个固定输出。 */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    this.requests.push(request)
    const structuredOutput = this.outputs.shift()
    if (structuredOutput === undefined) throw new Error('测试没有配置足够的模型输出')
    return { structuredOutput, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } }
  }
}

/** 记录反馈 Session 和人物反馈资料投影请求的测试队列。 */
class RecordingContextSyncQueue implements ContextSyncTaskQueue {
  /** 已请求投影的人物反馈资料。 */
  public readonly sourceIds: string[] = []
  /** 已请求写入 Session 的反馈。 */
  public readonly feedbackIds: string[] = []

  /** @param sourceId 资料 UUID。 @param _taskId 任务 UUID。 @param _timestamp 时间。 @param entityType 资料类型。 @returns 记录结束时完成。 */
  async enqueueSourceSynchronization(
    sourceId: string,
    _taskId: string,
    _timestamp: number,
    entityType: 'source_material' | 'persona_feedback_source' = 'source_material',
  ): Promise<void> {
    if (entityType === 'persona_feedback_source') this.sourceIds.push(sourceId)
  }

  /** @param sourceType 来源类型。 @param sourceId 来源 UUID。 @param _taskId 任务 UUID。 @param _timestamp 时间。 @returns 记录结束时完成。 */
  async enqueueSessionSynchronization(
    sourceType: 'run' | 'feedback',
    sourceId: string,
    _taskId: string,
    _timestamp: number,
  ): Promise<void> {
    if (sourceType === 'feedback') this.feedbackIds.push(sourceId)
  }
}

/** 测试使用的自由章节人物灵魂。 */
const BASE_SNAPSHOT: PersonaSnapshot = {
  chapters: [{
    id: '00000000-0000-4000-8000-000000000020',
    title: '核心设定',
    content: '谨慎的档案管理员，重视证据。',
    order: 0,
    required: true,
  }],
  runtimeSummary: '谨慎的档案管理员；资料不足时说明未知。',
}

/** 测试固定业务 UUID。 */
const IDS = {
  persona: '00000000-0000-4000-8000-000000000001',
  version: '00000000-0000-4000-8000-000000000002',
  run: '00000000-0000-4000-8000-000000000003',
  spec: '00000000-0000-4000-8000-000000000004',
  document: '00000000-0000-4000-8000-000000000005',
  block: '00000000-0000-4000-8000-000000000006',
  source: '00000000-0000-4000-8000-000000000007',
}

/** 当前测试临时目录。 */
let temporaryDirectory: string
/** 当前测试数据库。 */
let database: SqliteDatabase
/** 当前测试仓储。 */
let repository: SqliteFeedbackRepository

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-feedback-test-'))
  database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  repository = new SqliteFeedbackRepository(database.getClient())
  seedPublishedPersonaAndRun()
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('反馈分类与人物学习资料闭环', () => {
  it('最终数据库只保留新心智模型和反馈事实表', () => {
    const existing = database.getClient().prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'feedback_events', 'feedback_suggestions', 'feedback_resolutions', 'persona_feedback_sources',
        'growth_records', 'memory_records', 'evaluation_cases', 'revision_proposals', 'candidate_memories',
        'evaluation_runs', 'evaluation_results', 'persona_growth_records', 'persona_memories'
      ) ORDER BY name
    `).all()
    expect(existing).toEqual([
      { name: 'evaluation_cases' },
      { name: 'feedback_events' },
      { name: 'feedback_resolutions' },
      { name: 'feedback_suggestions' },
      { name: 'growth_records' },
      { name: 'memory_records' },
      { name: 'persona_feedback_sources' },
    ])
  })

  it('用户确认人物学习后只创建反馈资料，不直接修改灵魂、成长或记忆', async () => {
    const queue = new RecordingContextSyncQueue()
    const service = createService(new QueueTextModel([
      { targetType: 'persona', confidence: 0.96, rationale: '用户明确要求形成长期学习资料' },
    ]), queue)
    const feedback = await service.submitFeedback(IDS.run, {
      content: '以后回答时明确提到证据。', blockId: null, rating: 'positive', isLongTerm: true, editedOutput: null,
    })
    const confirmed = await service.confirmClassification(feedback.id, {
      targetType: 'persona', blockId: null, sourceId: null, hasEvidenceConflict: false,
    })

    expect(confirmed.resolution).toMatchObject({ personaId: IDS.persona, action: 'created_learning_source' })
    const feedbackSourceId = String(confirmed.resolution?.feedbackSourceId)
    expect(database.getClient().prepare(`
      SELECT persona_id, content, source_type, source_id, is_enabled, deletion_state
      FROM persona_feedback_sources WHERE id = ?
    `).get(feedbackSourceId)).toEqual({
      persona_id: IDS.persona,
      content: '以后回答时明确提到证据。',
      source_type: 'run_feedback',
      source_id: feedback.id,
      is_enabled: 1,
      deletion_state: 'active',
    })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM soul_versions').get()).toEqual({ count: 1 })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM soul_drafts').get()).toEqual({ count: 0 })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM growth_records').get()).toEqual({ count: 0 })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM memory_records').get()).toEqual({ count: 0 })
    expect(queue.feedbackIds).toEqual([feedback.id])
    expect(queue.sourceIds).toEqual([feedbackSourceId])
  })

  it('同一反馈只能确认一次，不能重复创建人物反馈资料', async () => {
    const service = createService(new QueueTextModel([
      { targetType: 'persona', confidence: 0.9, rationale: '人物学习资料' },
    ]))
    const feedback = await service.submitFeedback(IDS.run, {
      content: '保持短句。', blockId: null, rating: null, isLongTerm: true, editedOutput: null,
    })
    await service.confirmClassification(feedback.id, {
      targetType: 'persona', blockId: null, sourceId: null, hasEvidenceConflict: false,
    })

    await expect(service.confirmClassification(feedback.id, {
      targetType: 'persona', blockId: null, sourceId: null, hasEvidenceConflict: false,
    })).rejects.toMatchObject({ code: 'FEEDBACK_ALREADY_CLASSIFIED' })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM persona_feedback_sources').get()).toEqual({ count: 1 })
  })

  it('当前产物、参数和资料事实反馈只执行各自允许的动作', async () => {
    seedArtifactDocument()
    seedSource()
    const service = createService(new QueueTextModel([
      { targetType: 'artifact', confidence: 0.95, rationale: '只要求修正当前块' },
      { targetType: 'parameters', confidence: 0.8, rationale: '只要求降低输出长度' },
      { targetType: 'source_fact', confidence: 0.9, rationale: '指出资料事实错误' },
    ]))

    const artifact = await service.submitFeedback(IDS.run, {
      content: '这个段落太长，请重新生成。', blockId: IDS.block, rating: 'negative', isLongTerm: false, editedOutput: null,
    })
    const artifactResult = await service.confirmClassification(artifact.id, {
      targetType: 'artifact', blockId: IDS.block, sourceId: null, hasEvidenceConflict: false,
    })
    expect(artifactResult.resolution).toMatchObject({ blockId: IDS.block })
    expect(database.getClient().prepare('SELECT type, status FROM task_jobs WHERE run_id = ?').all(IDS.run))
      .toEqual([{ type: 'execute_block', status: 'queued' }])

    database.getClient().prepare(`UPDATE generation_runs SET status = 'succeeded' WHERE id = ?`).run(IDS.run)
    const parameters = await service.submitFeedback(IDS.run, {
      content: '下次把最大输出长度调低。', blockId: null, rating: null, isLongTerm: false, editedOutput: null,
    })
    expect((await service.confirmClassification(parameters.id, {
      targetType: 'parameters', blockId: null, sourceId: null, hasEvidenceConflict: false,
    })).resolution).toMatchObject({ scope: 'next_run_override', recommendation: '下次把最大输出长度调低。' })

    const sourceFact = await service.submitFeedback(IDS.run, {
      content: '资料中的出生年份与原著冲突。', blockId: null, rating: null, isLongTerm: false, editedOutput: null,
    })
    expect((await service.confirmClassification(sourceFact.id, {
      targetType: 'source_fact', blockId: null, sourceId: IDS.source, hasEvidenceConflict: true,
    })).resolution).toEqual({
      sourceId: IDS.source,
      conflict: true,
      recommendation: '资料中的出生年份与原著冲突。',
      automaticMindChange: false,
    })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM persona_feedback_sources').get()).toEqual({ count: 0 })
  })

  it('回归用例仍可独立维护，等待后续灵魂提案评测复用', async () => {
    const service = createService(new QueueTextModel([]))
    const created = await service.createEvaluationCase(IDS.persona, {
      name: '未知事实边界',
      category: 'safety',
      prompt: '判断一条没有来源的消息。',
      expectedChange: 'retain',
      requiredTerms: ['证据'],
      forbiddenTerms: ['我确定'],
      minimumScore: 0.7,
      maxRegression: 0.1,
    })

    expect(await service.listEvaluationCases(IDS.persona)).toEqual([created])
  })
})

/** @param model 固定模型。 @param contextSyncQueue 可选投影记录队列。 @returns 测试应用服务。 */
function createService(model: TextModelPort, contextSyncQueue?: ContextSyncTaskQueue): FeedbackApplicationService {
  return new FeedbackApplicationService({
    repository,
    model,
    identifiers: new SequentialIdentifierGenerator(),
    clock: new MutableClock(),
    contextSyncQueue,
  })
}

/** @returns 创建已发布人物灵魂和一条成功运行。 */
function seedPublishedPersonaAndRun(): void {
  const client = database.getClient()
  client.prepare(`
    INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
    VALUES (?, NULL, '林默', 'original', ?, 1000, 1000)
  `).run(IDS.persona, IDS.version)
  client.prepare(`
    INSERT INTO soul_versions (
      id, subject_type, world_id, persona_id, parent_version_id, chapters_json, runtime_summary,
      runtime_token_count, token_counter, change_summary, status, published_at, created_at
    ) VALUES (?, 'persona', NULL, ?, NULL, ?, ?, 20, 'test', '初始版本', 'published', 1000, 1000)
  `).run(IDS.version, IDS.persona, JSON.stringify(BASE_SNAPSHOT.chapters), BASE_SNAPSHOT.runtimeSummary)
  client.prepare(`
    INSERT INTO generation_runs (
      id, kind, persona_version_id, status, input_json, scene_json, parameter_snapshot_json,
      model_snapshot_json, image_model_snapshot_json, prompt_version, context_provider,
      prompt_context_snapshot_json, created_at, updated_at, completed_at
    ) VALUES (?, 'artifact_generation', ?, 'succeeded', ?, NULL, ?, ?, NULL, 'artifact-v5', 'sqlite_fts5', NULL, 2000, 2000, 2000)
  `).run(
    IDS.run,
    IDS.version,
    JSON.stringify({ requirement: '写一段档案说明', includeImages: false }),
    JSON.stringify({ temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000, maxEvidenceChunks: 8, maxTextBlocks: 12, maxImageBlocks: 4, maxPromptCharacters: 120000, maxTotalTokens: 50000, maxBlockAttempts: 2 }),
    JSON.stringify({ provider: 'openai_compatible', model: 'test-model', endpointOrigin: 'https://model.test' }),
  )
}

/** @returns 为固定运行创建一个已成功且未锁定的文字块。 */
function seedArtifactDocument(): void {
  const client = database.getClient()
  const spec = {
    title: '档案说明', summary: '摘要', purpose: '', constraints: [], requestedFormats: ['html'],
    blocks: [{ key: 'body', type: 'text', role: 'paragraph', instruction: '写正文', acceptanceCriteria: ['简洁'], dependsOn: [] }],
  }
  client.prepare(`
    INSERT INTO document_specs (id, run_id, revision, status, spec_json, confirmed_at, created_at)
    VALUES (?, ?, 1, 'confirmed', ?, 2000, 2000)
  `).run(IDS.spec, IDS.run, JSON.stringify(spec))
  client.prepare(`
    INSERT INTO artifact_documents (id, run_id, selected_spec_id, created_at, updated_at) VALUES (?, ?, ?, 2000, 2000)
  `).run(IDS.document, IDS.run, IDS.spec)
  client.prepare(`
    INSERT INTO artifact_blocks (
      id, document_id, spec_key, ordinal, type, role, spec_json, status, selected_attempt_id,
      is_locked, selected_at, locked_at, created_at, updated_at
    ) VALUES (?, ?, 'body', 0, 'text', 'paragraph', ?, 'succeeded', NULL, 0, NULL, NULL, 2000, 2000)
  `).run(IDS.block, IDS.document, JSON.stringify(spec.blocks[0]))
}

/** @returns 创建一个可被资料事实反馈引用的资料。 */
function seedSource(): void {
  database.getClient().prepare(`
    INSERT INTO source_materials (
      id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
    ) VALUES (?, '人物资料', 'canon_fact', 'paste', ?, '出生于北塔。', NULL, 1000, 1000)
  `).run(IDS.source, 'a'.repeat(64))
}
