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

/** 为人物蒸馏测试生成稳定且不重复的 UUID。 */
class SequentialIdentifierGenerator implements IdentifierGenerator {
  /** 当前递增序号。 */
  private sequence = 0

  /** @returns 下一个稳定 UUID。 */
  create(): string {
    this.sequence += 1
    return `80000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

/** 为人物蒸馏测试提供单调递增时间。 */
class TestClock implements Clock {
  /** 当前时间。 */
  private timestamp = 30_000

  /** @returns 下一毫秒时间。 */
  now(): number {
    this.timestamp += 1
    return this.timestamp
  }
}

/** 返回四步合法结果并记录执行顺序的固定人物蒸馏算法。 */
class FixedPersonaDistillationAlgorithms {
  /** 实际执行的步骤顺序。 */
  readonly executedSteps: string[] = []
  /** 是否在没有资料输入时模拟模型虚构返回一项资料分类。 */
  hallucinateEmptySourceAssessment = false

  /** @returns 固定的四步非敏感算法快照。 */
  async prepare(): Promise<AiAlgorithmSnapshot> {
    return {
      algorithmCode: 'persona_distillation',
      implementationVersion: 1,
      configurationVersionId: '90000000-0000-4000-8000-000000000001',
      configurationVersion: 1,
      steps: ['classify_sources', 'extract_claims', 'synthesize_soul', 'evaluate_soul'].map((stepKey, ordinal) => ({
        stepKey,
        ordinal,
        modelDeploymentId: `90000000-0000-4000-8000-${String(ordinal + 2).padStart(12, '0')}`,
        connectionId: '90000000-0000-4000-8000-000000000010',
        protocol: 'openai_compatible' as const,
        endpoint: 'https://model.test/v1',
        model: 'distillation-test-model',
        promptCode: `distillation.${stepKey}`,
        promptVersionId: `90000000-0000-4000-8000-${String(ordinal + 20).padStart(12, '0')}`,
        parameters: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      })),
    }
  }

  /**
   * 按固定步骤返回资料分类、认知候选、灵魂正文或六维评测。
   * @param _snapshot 已固定算法快照。
   * @param stepKey 当前固定步骤。
   * @param variables 当前步骤变量。
   * @returns 不调用真实模型的固定结构化响应。
   */
  async executeStep(
    _snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
  ): Promise<TextModelResponse> {
    this.executedSteps.push(stepKey)
    const inputs = 'inputsJson' in variables
      ? JSON.parse(variables.inputsJson) as Array<{ id: string, inputType: string }>
      : []
    const requirement = inputs.find(input => input.inputType === 'user_statement')
    const sourceInputs = inputs.filter(input => input.inputType === 'source_material')
    const structuredOutput = stepKey === 'classify_sources'
      ? { sources: sourceInputs.length === 0 && this.hallucinateEmptySourceAssessment
          ? [{
              inputId: '90000000-0000-4000-8000-000000000099',
              sourceRelation: 'third_party',
              coverageDimensions: ['external_views'],
              independentSourceKey: 'hallucinated-source',
            }]
          : sourceInputs.map(input => ({
          inputId: input.id,
          sourceRelation: 'third_party',
          coverageDimensions: ['conversations'],
          independentSourceKey: `model:${input.id}`,
        })) }
      : stepKey === 'extract_claims'
        ? { claims: [{
            category: 'mental_model',
            statement: '先明确判断依据。',
            applicability: '事实判断',
            limitations: '只有用户明确要求支持，不能冒充真实经历。',
            basis: 'explicit',
            confidence: 0.9,
            evidence: [{ inputId: requirement?.id, relation: 'supporting', quote: '提炼判断方式' }],
            conflicts: [],
          }] }
        : stepKey === 'synthesize_soul'
          ? { name: '顾岚', snapshot: { promptText: '# 心智模型\n先明确判断依据。' } }
          : { evaluations: [
              'known_fact',
              'decision_tendency',
              'unknown_boundary',
              'expression',
              'counterfactual',
              'conflict_handling',
            ].map(evaluationType => ({
              evaluationType,
              status: 'passed',
              score: 1,
              summary: `${evaluationType} 通过`,
              failureReasons: [],
            })) }
    return {
      structuredOutput,
      rawOutput: JSON.stringify(structuredOutput),
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    }
  }
}

let directory: string
let database: SqliteDatabase
let service: PersonaDistillationApplicationService
let worker: WorkerApplicationService
let algorithms: FixedPersonaDistillationAlgorithms

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-persona-distillation-app-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  const identifiers = new SequentialIdentifierGenerator()
  const clock = new TestClock()
  algorithms = new FixedPersonaDistillationAlgorithms()
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
    taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
    taskHandler: service,
    clock,
    leaseDurationMs: 60_000,
  })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('人物蒸馏应用闭环', () => {
  it('没有资料时由程序直接形成零覆盖，不调用可能虚构输入的资料分类模型', async () => {
    algorithms.hallucinateEmptySourceAssessment = true
    const created = await service.createRun({
      requestedName: '顾岚',
      objective: '仅依据用户明确设定创建人物。',
      worldId: null,
      sourceIds: [],
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    await expect(service.getRun(created.id)).resolves.toMatchObject({
      status: 'awaiting_source_review',
      coverageSnapshot: { sourceCount: 0, independentSourceCount: 0 },
    })
    expect(algorithms.executedSteps).toEqual([])
  })

  it('创建运行时固定资料来源元数据并按原始来源键进行同源分组', async () => {
    const sourceId = '70000000-0000-4000-8000-000000000001'
    database.getClient().prepare(`
      INSERT INTO source_materials (
        id, name, role, input_type, content_hash, content_text, original_file_path,
        origin_url, author_name, published_at, original_source_key, created_at, updated_at
      ) VALUES (?, '人物访谈转载', 'reference', 'paste', ?, '完整访谈正文。', NULL, ?, ?, ?, ?, 1000, 1000)
    `).run(
      sourceId,
      'd'.repeat(64),
      'https://example.com/interview-copy',
      '受访者',
      1_700_000_000_000,
      'interview:original:2023',
    )

    const created = await service.createRun({
      requestedName: '顾岚',
      objective: '提炼判断方式。',
      worldId: null,
      sourceIds: [sourceId],
    })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const assessed = await service.getRun(created.id)
    expect(assessed.inputs.find(input => input.sourceId === sourceId)).toMatchObject({
      independentSourceKey: 'interview:original:2023',
      originUrl: 'https://example.com/interview-copy',
      authorName: '受访者',
      publishedAt: 1_700_000_000_000,
    })
  })

  it('无资料人物经过程序零覆盖、两个检查点和哈希门禁后创建当前灵魂版本', async () => {
    const created = await service.createRun({
      requestedName: '顾岚',
      objective: '提炼判断方式并保持未知边界。',
      worldId: null,
      sourceIds: [],
    })
    expect(created).toMatchObject({ status: 'assessing_sources', requestedName: '顾岚' })

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const assessed = await service.getRun(created.id)
    expect(assessed).toMatchObject({
      status: 'awaiting_source_review',
      coverageSnapshot: { sourceCount: 0, independentSourceCount: 0 },
    })

    await service.reviewSources(created.id, {
      expectedUpdatedAt: assessed.updatedAt,
      acceptedInputIds: [],
      corrections: [],
    })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    const candidate = await service.getRun(created.id)
    expect(candidate).toMatchObject({
      status: 'awaiting_candidate_review',
      candidateName: '顾岚',
      candidatePromptText: '# 心智模型\n先明确判断依据。',
      candidatePromptHash: candidate.evaluatedPromptHash,
    })
    expect(algorithms.executedSteps).toEqual([
      'extract_claims',
      'synthesize_soul',
      'evaluate_soul',
    ])

    const confirmed = await service.confirmCandidate(created.id, {
      expectedUpdatedAt: candidate.updatedAt,
      name: '顾岚',
      expectedPromptHash: candidate.candidatePromptHash,
    })
    expect(confirmed).toMatchObject({ status: 'completed', createdPersonaId: expect.any(String) })
    const persona = database.getClient().prepare(`
      SELECT personas.name, soul_versions.prompt_text
      FROM personas
      INNER JOIN soul_versions ON soul_versions.id = personas.active_soul_version_id
      WHERE personas.id = ?
    `).get(confirmed.createdPersonaId) as { name: string, prompt_text: string }
    expect(persona).toEqual({ name: '顾岚', prompt_text: '# 心智模型\n先明确判断依据。' })
  })
})
