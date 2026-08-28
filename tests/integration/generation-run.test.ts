import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { GenerationApplicationService } from '../../server/application/generation/GenerationApplicationService'
import { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteContextProvider } from '../../server/infrastructure/context/SqliteContextProvider'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteRunRepository } from '../../server/infrastructure/database/SqliteRunRepository'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'
import { SystemIdentifierGenerator } from '../../server/infrastructure/system/SystemIdentifierGenerator'
import type { Clock } from '../../server/ports/Clock'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import { TextModelError } from '../../server/ports/TextModelPort'
import type { PersonaSnapshot } from '../../shared/types/content'

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
  /** 是否让第一次兴趣输出故意无效。 */
  public invalidInterestOnce = false
  /** 是否持续返回无效兴趣结构。 */
  public invalidInterestAlways = false
  /** 兴趣调用前还要模拟的限流次数。 */
  public interestRateLimitsRemaining = 0

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
    if (request.responseSchemaName === 'interest_assessment') {
      if (this.interestRateLimitsRemaining > 0) {
        this.interestRateLimitsRemaining -= 1
        throw new TextModelError('PROVIDER_RATE_LIMITED', '测试限流', true)
      }
      if (this.invalidInterestAlways || (this.invalidInterestOnce && call === 1)) return response({ decision: 'invalid' })
      const evidence = readEvidence(request.userPrompt)
      const fact = evidence.find(item => item.role === 'canon_fact')
      return response({
        probability: 0.88,
        confidence: 0.82,
        decision: 'interested',
        factors: [{ dimension: 'topic', score: 0.9, explanation: '符合人物兴趣。' }],
        supportingEvidenceIds: fact ? [fact.id] : [],
        opposingEvidenceIds: [],
        unknowns: [],
        reasoningSummary: '人物偏好与内容主题一致。',
      })
    }
    if (request.responseSchemaName === 'document_spec') {
      return response({
        title: '学院观察',
        summary: '以人物口吻介绍学院。',
        blocks: [
          { key: 'title', role: 'heading', instruction: '写标题', acceptanceCriteria: ['简短'], dependsOn: [] },
          { key: 'body', role: 'paragraph', instruction: '写正文', acceptanceCriteria: ['符合人物风格'], dependsOn: ['title'] },
        ],
      })
    }
    const currentBlockInstruction = request.userPrompt.match(/<当前块任务>(.*?)<\/当前块任务>/s)?.[1]
    return response({ text: currentBlockInstruction === '"写标题"' ? '学院观察' : '这里的课程值得认真研究。' })
  }
}

/** 明确关闭能力的测试模型。 */
class DisabledTextModel extends FixedTextModel {
  /** @returns 始终返回 null。 */
  override getConfiguredModel(): null { return null }
}

/** @param structuredOutput 固定结构。 @returns 统一模型响应。 */
function response(structuredOutput: unknown): TextModelResponse {
  return { structuredOutput, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
}

/** @param prompt 分层用户提示。 @returns 提示中的证据简表。 */
function readEvidence(prompt: string): Array<{ id: string, role: string }> {
  const match = /<不可信证据资料>(.*?)<\/不可信证据资料>/s.exec(prompt)
  return match ? JSON.parse(match[1]!) as Array<{ id: string, role: string }> : []
}

const PERSONA_SNAPSHOT: PersonaSnapshot = {
  summary: '热爱知识的学院观察员',
  identityFacts: '由用户明确创建。',
  interests: '课程与图书馆。',
  valuesAndMotivations: '重视求证。',
  expressionStyle: '冷静简洁。',
  appearance: '',
  visualStyle: '',
  constraints: '资料不足时说明未知。',
}

let directory: string
let database: SqliteDatabase
let contentService: ContentApplicationService
let generation: GenerationApplicationService
let worker: WorkerApplicationService
let model: FixedTextModel
let personaId: string
let sourceId: string
let testClock: TestClock

beforeEach(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-generation-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  const identifiers = new SystemIdentifierGenerator()
  testClock = new TestClock()
  const contentRepository = new SqliteContentRepository(database.getClient())
  const processor = new NodeSourceContentProcessor(identifiers)
  contentService = new ContentApplicationService({
    repository: contentRepository, identifiers, clock: testClock, sourceProcessor: processor,
    sourceFiles: new LocalSourceFileStorage(directory),
  })
  const source = await contentService.createPastedSource({
    name: '学院原著事实', role: 'canon_fact', content: '魔法学院课程包含古代文献研究与档案整理。',
  })
  sourceId = source.source.id
  const persona = await contentService.createPersona({
    name: '林默', origin: 'source_based', worldId: null, sourceIds: [source.source.id],
    snapshot: PERSONA_SNAPSHOT, changeSummary: '建立人物',
  })
  await contentService.publishPersonaVersion(persona.versions[0]!.id)
  personaId = persona.persona.id
  model = new FixedTextModel()
  generation = new GenerationApplicationService({
    runs: new SqliteRunRepository(database.getClient()), content: contentRepository,
    context: new SqliteContextProvider(database.getClient()), model, identifiers, clock: testClock, sourceProcessor: processor,
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
  it('保存固定输入与证据快照并完成结构化兴趣判断', async () => {
    model.invalidInterestOnce = true
    const created = await generation.createInterestRun({
      personaId,
      content: '魔法学院课程是否值得参加？',
      scene: { ageStage: '', location: '图书馆', currentGoal: '', emotion: '', event: '' },
      parameterProfileId: null,
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const details = await generation.getRun(created.runId)
    expect(details.run).toMatchObject({
      status: 'succeeded',
      result: { decision: 'interested', probability: 0.88, confidence: 0.82 },
      scene: { location: '图书馆' },
      promptVersion: 'text-v1',
      contextProvider: 'sqlite_fts5',
    })
    expect(details.evidence.map(item => item.role)).toEqual(['user_setting', 'canon_fact'])
    expect(details.run.result?.supportingEvidenceIds).toEqual([details.evidence[1]!.id])
    expect(model.calls.get('interest_assessment')).toBe(2)
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
  })

  it('排队运行可协作取消且不会再被 Worker 领取', async () => {
    const created = await generation.createInterestRun({ personaId, content: '魔法学院课程', parameterProfileId: null })
    await generation.cancelRun(created.runId)
    expect((await generation.getRun(created.runId)).run.status).toBe('canceled')
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: false })
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
      identifiers: new SystemIdentifierGenerator(),
      clock: new TestClock(),
      sourceProcessor: new NodeSourceContentProcessor(new SystemIdentifierGenerator()),
    })
    await expect(disabled.createInterestRun({ personaId, content: '测试' })).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
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
    expect(failed.run).toMatchObject({ status: 'failed', errorCode: 'MODEL_OUTPUT_INVALID' })
    expect(failed.tasks[0]).toMatchObject({ status: 'failed', attemptCount: 2 })

    model.invalidInterestAlways = false
    const retried = await generation.retryRun(created.runId)
    expect(retried.taskId).not.toBe(created.taskId)
    await worker.executeNext()
    const completed = await generation.getRun(created.runId)
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
