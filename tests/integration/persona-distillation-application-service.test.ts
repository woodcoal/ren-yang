import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PersonaDistillationApplicationService } from '../../server/application/distillation/PersonaDistillationApplicationService'
import { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import type { AiAlgorithmSnapshot } from '../../server/domain/ai/AiAlgorithmModels'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteDistillationRepository } from '../../server/infrastructure/database/SqliteDistillationRepository'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'
import { ConservativeTokenCounter } from '../../server/infrastructure/model/ConservativeTokenCounter'
import type { Clock } from '../../server/ports/Clock'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { TextModelResponse } from '../../server/ports/TextModelPort'
import { TextModelError } from '../../server/ports/TextModelPort'

/** 为自由蒸馏测试生成稳定且不重复的 UUID。 */
class SequentialIdentifierGenerator implements IdentifierGenerator {
  /** 当前递增序号。 */
  private sequence = 0

  /** @returns 下一个稳定 UUID。 */
  create(): string {
    this.sequence += 1
    return `80000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

/** 为自由蒸馏测试提供单调递增时间。 */
class TestClock implements Clock {
  /** 当前时间。 */
  private timestamp = 30_000

  /** @returns 下一毫秒时间。 */
  now(): number {
    this.timestamp += 1
    return this.timestamp
  }
}

/** 固定返回一次分析报告和候选的测试算法。 */
class FixedFreeformDistillationAlgorithms {
  /** 已执行的固定步骤。 */
  readonly executedSteps: string[] = []
  /** 首次调用是否模拟瞬态 JSON 错误。 */
  failOnce = false

  /** @returns 单次自由蒸馏算法快照。 */
  async prepare(): Promise<AiAlgorithmSnapshot> {
    return {
      algorithmCode: 'persona_distillation',
      implementationVersion: 2,
      configurationVersionId: '90000000-0000-4000-8000-000000000001',
      configurationVersion: 1,
      steps: [{
        stepKey: 'analyze', ordinal: 0, modelDeploymentId: '90000000-0000-4000-8000-000000000002',
        connectionId: '90000000-0000-4000-8000-000000000003', protocol: 'openai_compatible',
        endpoint: 'https://model.test/v1', model: 'distillation-test-model', modality: 'text',
        promptCode: 'distillation.analyze_persona', promptVersionId: '90000000-0000-4000-8002-000000000001',
        parameters: { temperature: 0.2, maxOutputTokens: 8_192, timeoutMs: 60_000 }, thinkingDisableMode: 'none',
      }],
    }
  }

  /** @returns 模拟模型一次完成的自由分析结果。 */
  async executeStep(
    _snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    _responseSchemaName?: string,
    _responseFormat?: 'json_object' | 'text',
    options?: { validateStructuredOutput?: (value: unknown) => void },
  ): Promise<TextModelResponse> {
    this.executedSteps.push(stepKey)
    if (this.failOnce) {
      this.failOnce = false
      throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型返回的内容不是有效 JSON', true)
    }
    const inputs = JSON.parse(variables.inputsJson) as Array<{ name: string, content: string }>
    const sourceNames = inputs.filter(input => input.name !== '用户创建要求').map(input => input.name).join('、') || '用户明确要求'
    const structuredOutput = {
      analysisReport: `## 判断方式\n优先区分证据与推断。\n\n## 依据\n本次参考：${sourceNames}。\n\n## 未知边界\n资料未覆盖的经历不作断言。`,
      name: '顾岚',
      promptText: '# 心智模型\n先明确判断依据。\n\n# 诚实边界\n资料不足时明确说明未知。',
    }
    options?.validateStructuredOutput?.(structuredOutput)
    return {
      structuredOutput,
      rawOutput: JSON.stringify(structuredOutput),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }
  }
}

let directory: string
let database: SqliteDatabase
let service: PersonaDistillationApplicationService
let worker: WorkerApplicationService
let algorithms: FixedFreeformDistillationAlgorithms

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-freeform-distillation-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  const identifiers = new SequentialIdentifierGenerator()
  const clock = new TestClock()
  algorithms = new FixedFreeformDistillationAlgorithms()
  service = new PersonaDistillationApplicationService({
    content: new SqliteContentRepository(database.getClient()),
    distillations: new SqliteDistillationRepository(database.getClient()),
    algorithms,
    identifiers,
    clock,
    tokenCounter: new ConservativeTokenCounter(),
    personaSoulTokenBudget: 3_500,
    context: { getProvider: () => 'sqlite_fts5' },
  })
  worker = new WorkerApplicationService({
    taskJobRepository: new SqliteTaskJobRepository(database.getClient()), taskHandler: service, clock, leaseDurationMs: 60_000,
  })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('人物自由蒸馏应用闭环', () => {
  it('一次模型调用保存完整分析报告和候选，随后由人工确认创建人物', async () => {
    const created = await service.createRun({
      requestedName: '顾岚', objective: '提炼谨慎且重视证据的判断方式。', worldId: null, sourceIds: [],
    })
    expect(created).toMatchObject({ status: 'analyzing' })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const candidate = await service.getRun(created.id)
    expect(candidate).toMatchObject({
      status: 'awaiting_candidate_review', candidateName: '顾岚',
      analysisReport: expect.stringContaining('未知边界'),
      candidatePromptText: expect.stringContaining('# 心智模型'),
      candidatePromptHash: candidate.preparedPromptHash,
    })
    expect(algorithms.executedSteps).toEqual(['analyze'])

    const confirmed = await service.confirmCandidate(created.id, {
      expectedUpdatedAt: candidate.updatedAt, name: '顾岚', expectedPromptHash: candidate.candidatePromptHash,
    })
    expect(confirmed).toMatchObject({ status: 'completed', createdPersonaId: expect.any(String) })
  })

  it('人工校准候选后不再调用模型，校准正文可直接确认', async () => {
    const created = await service.createRun({ requestedName: '顾岚', objective: '提炼判断方式。', worldId: null, sourceIds: [] })
    await worker.executeNext()
    const analyzed = await service.getRun(created.id)

    const saved = await service.saveCandidate(created.id, {
      expectedUpdatedAt: analyzed.updatedAt, promptText: '# 校准后的心智模型\n面对证据不足时保留判断。',
    })
    expect(saved).toMatchObject({
      status: 'awaiting_candidate_review',
      candidatePromptText: '# 校准后的心智模型\n面对证据不足时保留判断。',
      candidatePromptHash: saved.preparedPromptHash,
    })
    expect(algorithms.executedSteps).toEqual(['analyze'])

    await expect(service.confirmCandidate(created.id, {
      expectedUpdatedAt: saved.updatedAt, name: '顾岚', expectedPromptHash: saved.candidatePromptHash,
    })).resolves.toMatchObject({ status: 'completed' })
  })

  it('可重试模型错误保留分析阶段，由同一持久任务重新领取', async () => {
    algorithms.failOnce = true
    const created = await service.createRun({ requestedName: '顾岚', objective: '提炼判断方式。', worldId: null, sourceIds: [] })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })
    await expect(service.getRun(created.id)).resolves.toMatchObject({ status: 'analyzing' })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    await expect(service.getRun(created.id)).resolves.toMatchObject({ status: 'awaiting_candidate_review' })
  })

  it('创建时仍拒绝超出单次模型输入预算的资料组合', async () => {
    const sourceId = '70000000-0000-4000-8000-000000000021'
    database.getClient().prepare(`
      INSERT INTO source_materials (id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at)
      VALUES (?, '超长人物资料', 'reference', 'paste', ?, ?, NULL, 1000, 1000)
    `).run(sourceId, 'f'.repeat(64), '证据'.repeat(24_001))

    await expect(service.createRun({
      requestedName: '顾岚', objective: '提炼判断方式。', worldId: null, sourceIds: [sourceId],
    })).rejects.toMatchObject({ code: 'TASK_LIMIT_EXCEEDED', statusCode: 422 })
  })
})
