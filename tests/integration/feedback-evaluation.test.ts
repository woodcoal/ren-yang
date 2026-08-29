import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { FeedbackApplicationService } from '../../server/application/feedback/FeedbackApplicationService'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteFeedbackRepository } from '../../server/infrastructure/database/SqliteFeedbackRepository'
import type { Clock } from '../../server/ports/Clock'
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

/** 测试使用的基础人物快照。 */
const BASE_SNAPSHOT: PersonaSnapshot = {
  summary: '谨慎的档案管理员',
  identityFacts: '由用户原创设定。',
  interests: '历史与文献。',
  valuesAndMotivations: '重视证据。',
  expressionStyle: '简洁克制。',
  appearance: '',
  visualStyle: '',
  constraints: '资料不足时说明未知。',
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
  seedPublishedPersonaAndRun(false)
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('反馈、提案、评测与发布闭环', () => {
  it('0004 迁移建立反馈、评测、候选记忆和上下文同步事实表', () => {
    const names = database.getClient().prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'feedback_events', 'feedback_suggestions', 'feedback_resolutions', 'revision_proposals',
        'candidate_memories', 'evaluation_cases', 'evaluation_runs', 'evaluation_results', 'context_sync_records'
      ) ORDER BY name
    `).all()
    expect(names).toEqual([
      { name: 'candidate_memories' },
      { name: 'context_sync_records' },
      { name: 'evaluation_cases' },
      { name: 'evaluation_results' },
      { name: 'evaluation_runs' },
      { name: 'feedback_events' },
      { name: 'feedback_resolutions' },
      { name: 'feedback_suggestions' },
      { name: 'revision_proposals' },
    ])
  })

  it('低风险长期反馈创建不可变候选版本，通过固定评测后受控自动发布', async () => {
    const model = new QueueTextModel([
      { targetType: 'persona', confidence: 0.96, rationale: '用户明确要求长期调整表达风格' },
      {
        baseOutput: '我会查看记录。', candidateOutput: '我会先核对证据，再给出简短结论。',
        baseScore: 0.7, candidateScore: 0.92, reasoningSummary: '候选版本更符合目标风格。',
      },
    ])
    const service = createService(model, true)
    const feedback = await service.submitFeedback(IDS.run, {
      content: '以后回答时明确提到证据。', blockId: null, rating: 'positive', isLongTerm: true, editedOutput: null,
    })
    expect(feedback).toMatchObject({ confirmedTarget: null, suggestion: { targetType: 'persona', confidence: 0.96 } })

    const confirmed = await service.confirmClassification(feedback.id, {
      targetType: 'persona', blockId: null, sourceId: null, hasEvidenceConflict: false,
      personaPatches: [{ field: 'expressionStyle', after: '简洁克制。回答时明确提到证据。', reason: '用户明确长期偏好' }],
    })
    const proposalId = String(confirmed.resolution?.proposalId)
    const proposal = await service.getRevisionProposal(proposalId)
    expect(proposal).toMatchObject({ riskLevel: 'low', status: 'awaiting_evaluation', baseVersionId: IDS.version })
    expect(await service.getCandidateMemory(feedback.id)).toMatchObject({ status: 'promoted', proposalId })

    await service.createEvaluationCase(IDS.persona, {
      name: '证据优先表达', category: 'style', prompt: '说明你如何处理一条未经证实的消息。',
      expectedChange: 'improve', requiredTerms: ['证据'], forbiddenTerms: ['我确定'], minimumScore: 0.8, maxRegression: 0.1,
    })
    const evaluation = await executeEvaluation(service, proposalId)
    expect(evaluation).toMatchObject({ status: 'passed', passedCases: 1, totalCases: 1 })
    expect(evaluation.results[0]).toMatchObject({ status: 'passed', baseScore: 0.7, candidateScore: 0.92 })

    const published = await service.getRevisionProposal(proposalId)
    expect(published).toMatchObject({ status: 'published', decisionReason: '低风险提案已通过评测和全部自动发布门禁' })
    const rows = database.getClient().prepare(`SELECT id, status, snapshot_json FROM persona_versions ORDER BY created_at`).all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: IDS.version, status: 'published' })
    expect(JSON.parse(String(rows[1]!.snapshot_json))).toMatchObject({ expressionStyle: '简洁克制。回答时明确提到证据。' })
    expect(database.getClient().prepare('SELECT active_version_id FROM personas WHERE id = ?').get(IDS.persona))
      .toEqual({ active_version_id: published.candidateVersionId })
  })

  it('身份事实属于高风险，即使评测通过且启用自动发布仍等待人工确认', async () => {
    const model = new QueueTextModel([
      { targetType: 'persona', confidence: 0.9, rationale: '用户要求长期改变身份事实' },
      {
        baseOutput: '我是档案管理员。', candidateOutput: '我是北塔档案管理员。',
        baseScore: 0.8, candidateScore: 0.9, reasoningSummary: '候选符合目标。',
      },
    ])
    const service = createService(model, true)
    const feedback = await service.submitFeedback(IDS.run, {
      content: '设定他来自北塔。', blockId: null, rating: null, isLongTerm: true, editedOutput: null,
    })
    const confirmed = await service.confirmClassification(feedback.id, {
      targetType: 'persona', blockId: null, sourceId: null, hasEvidenceConflict: false,
      personaPatches: [{ field: 'identityFacts', after: '由用户原创设定，来自北塔。', reason: '新增身份事实' }],
    })
    const proposalId = String(confirmed.resolution?.proposalId)
    await service.createEvaluationCase(IDS.persona, {
      name: '身份一致性', category: 'behavior', prompt: '介绍自己的职责。', expectedChange: 'improve',
      requiredTerms: ['北塔'], forbiddenTerms: [], minimumScore: 0.8, maxRegression: 0.1,
    })
    await executeEvaluation(service, proposalId)
    expect(await service.getRevisionProposal(proposalId)).toMatchObject({ riskLevel: 'high', status: 'ready' })
    expect(database.getClient().prepare('SELECT active_version_id FROM personas WHERE id = ?').get(IDS.persona))
      .toEqual({ active_version_id: IDS.version })

    await service.publishProposal(proposalId)
    expect(await service.getRevisionProposal(proposalId)).toMatchObject({ status: 'published' })
    expect(database.getClient().prepare(`
      SELECT action, target_id FROM audit_events WHERE action = 'revision_proposal_published'
    `).get()).toEqual({ action: 'revision_proposal_published', target_id: proposalId })
  })

  it('评测硬规则失败时不发布候选版本，并保存逐用例失败依据', async () => {
    const model = new QueueTextModel([
      { targetType: 'persona', confidence: 0.9, rationale: '长期表达调整' },
      {
        baseOutput: '尚无证据。', candidateOutput: '我确定消息是真的。',
        baseScore: 0.8, candidateScore: 0.95, reasoningSummary: '模型评分较高，但违反禁用词。',
      },
    ])
    const service = createService(model, true)
    const feedback = await service.submitFeedback(IDS.run, {
      content: '回答再肯定一些。', blockId: null, rating: null, isLongTerm: true, editedOutput: null,
    })
    const confirmed = await service.confirmClassification(feedback.id, {
      targetType: 'persona', blockId: null, sourceId: null, hasEvidenceConflict: false,
      personaPatches: [{ field: 'expressionStyle', after: '简洁克制。语气更肯定。', reason: '表达调整' }],
    })
    const proposalId = String(confirmed.resolution?.proposalId)
    await service.createEvaluationCase(IDS.persona, {
      name: '未知事实边界', category: 'safety', prompt: '判断一条没有来源的消息。', expectedChange: 'retain',
      requiredTerms: ['证据'], forbiddenTerms: ['我确定'], minimumScore: 0.7, maxRegression: 0.1,
    })
    const evaluation = await executeEvaluation(service, proposalId)
    expect(evaluation.status).toBe('failed')
    expect(evaluation.results[0]?.failures).toEqual([
      '候选输出缺少必需词：证据',
      '候选输出包含禁用词：我确定',
    ])
    expect(await service.getRevisionProposal(proposalId)).toMatchObject({ status: 'evaluation_failed' })
  })

  it('当前产物、参数和资料事实反馈分别执行单块重试、参数建议和资料冲突记录', async () => {
    seedArtifactDocument()
    seedSource()
    const model = new QueueTextModel([
      { targetType: 'artifact', confidence: 0.95, rationale: '只要求修正当前块' },
      { targetType: 'parameters', confidence: 0.8, rationale: '只要求降低输出长度' },
      { targetType: 'source_fact', confidence: 0.9, rationale: '指出资料事实错误' },
    ])
    const service = createService(model, false)

    const artifact = await service.submitFeedback(IDS.run, {
      content: '这个段落太长，请重新生成。', blockId: IDS.block, rating: 'negative', isLongTerm: false, editedOutput: null,
    })
    const artifactResult = await service.confirmClassification(artifact.id, {
      targetType: 'artifact', blockId: IDS.block, personaPatches: [], sourceId: null, hasEvidenceConflict: false,
    })
    expect(artifactResult.resolution).toMatchObject({ blockId: IDS.block })
    expect(database.getClient().prepare('SELECT type, status FROM task_jobs WHERE run_id = ?').all(IDS.run))
      .toEqual([{ type: 'execute_block', status: 'queued' }])

    database.getClient().prepare(`UPDATE generation_runs SET status = 'succeeded' WHERE id = ?`).run(IDS.run)
    const parameters = await service.submitFeedback(IDS.run, {
      content: '下次把最大输出长度调低。', blockId: null, rating: null, isLongTerm: false, editedOutput: null,
    })
    expect((await service.confirmClassification(parameters.id, {
      targetType: 'parameters', blockId: null, personaPatches: [], sourceId: null, hasEvidenceConflict: false,
    })).resolution).toMatchObject({ scope: 'next_run_override', recommendation: '下次把最大输出长度调低。' })

    const sourceFact = await service.submitFeedback(IDS.run, {
      content: '资料中的出生年份与原著冲突。', blockId: null, rating: null, isLongTerm: false, editedOutput: null,
    })
    expect((await service.confirmClassification(sourceFact.id, {
      targetType: 'source_fact', blockId: null, personaPatches: [], sourceId: IDS.source, hasEvidenceConflict: true,
    })).resolution).toEqual({
      sourceId: IDS.source,
      conflict: true,
      recommendation: '资料中的出生年份与原著冲突。',
      automaticPersonaChange: false,
    })
    expect(await service.listRevisionProposals({})).toEqual([])
  })
})

/** @param model 固定模型。 @param autoPublishLowRisk 是否自动发布。 @returns 测试应用服务。 */
function createService(model: TextModelPort, autoPublishLowRisk: boolean): FeedbackApplicationService {
  return new FeedbackApplicationService({
    repository,
    model,
    identifiers: new SequentialIdentifierGenerator(),
    clock: new MutableClock(),
    autoPublishLowRisk,
  })
}

/** @param service 反馈应用服务。 @param proposalId 提案 UUID。 @returns 通过模拟 Worker 完成后的评测视图。 */
async function executeEvaluation(service: FeedbackApplicationService, proposalId: string) {
  const queued = await service.enqueueProposalEvaluation(proposalId)
  expect(await service.getEvaluationRun(queued.evaluationRunId)).toMatchObject({ status: 'queued', results: [] })
  await service.execute({
    id: queued.taskId,
    type: 'evaluate_proposal',
    payloadJson: JSON.stringify({ evaluationRunId: queued.evaluationRunId }),
    status: 'running',
    attemptCount: 1,
    maxAttempts: 2,
    leaseUntil: 20_000,
  })
  return await service.getEvaluationRun(queued.evaluationRunId)
}

/** @param withArtifact 是否立即创建产物；产物可在具体测试中延迟创建。 @returns 无返回值。 */
function seedPublishedPersonaAndRun(withArtifact: boolean): void {
  const client = database.getClient()
  client.prepare(`
    INSERT INTO personas (id, world_id, name, origin, active_version_id, created_at, updated_at)
    VALUES (?, NULL, '林默', 'original', ?, 1000, 1000)
  `).run(IDS.persona, IDS.version)
  client.prepare(`
    INSERT INTO persona_versions (id, persona_id, parent_version_id, status, snapshot_json, change_summary, published_at, created_at)
    VALUES (?, ?, NULL, 'published', ?, '初始版本', 1000, 1000)
  `).run(IDS.version, IDS.persona, JSON.stringify(BASE_SNAPSHOT))
  client.prepare(`
    INSERT INTO generation_runs (
      id, kind, persona_version_id, status, input_json, scene_json, parameter_snapshot_json,
      model_snapshot_json, image_model_snapshot_json, prompt_version, context_provider, created_at, updated_at, completed_at
    ) VALUES (?, 'artifact_generation', ?, 'succeeded', ?, NULL, ?, ?, NULL, 'artifact-v2', 'sqlite_fts5', 2000, 2000, 2000)
  `).run(
    IDS.run,
    IDS.version,
    JSON.stringify({ requirement: '写一段档案说明', includeImages: false }),
    JSON.stringify({ temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000, maxEvidenceChunks: 8, maxTextBlocks: 12 }),
    JSON.stringify({ provider: 'openai_compatible', model: 'test-model', endpointOrigin: 'https://model.test' }),
  )
  if (withArtifact) seedArtifactDocument()
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
