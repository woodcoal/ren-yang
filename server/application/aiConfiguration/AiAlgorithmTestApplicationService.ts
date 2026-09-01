import { z, type ZodType } from 'zod'
import {
  modelGrowthAtomicFactSchema,
  modelGrowthExtractionResultSchema,
  modelLearningPromptResultSchema,
  modelMemoryExtractionResultSchema,
} from '../../../shared/schemas/analysis'
import type { AiAlgorithmTestInput } from '../../../shared/schemas/aiAlgorithmTest'
import { analyzedSoulPromptSchema } from '../../../shared/schemas/content'
import type { AiAlgorithmTestResult, AiAlgorithmTestStepResult } from '../../../shared/types/aiAlgorithmTest'
import type { AiAlgorithmCode } from '../../../shared/types/aiConfiguration'
import { getAiAlgorithmDefinition } from '../../domain/ai/AiAlgorithmDefinitions'
import { normalizeSoulSnapshot } from '../../domain/content/SoulRules'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { validateAndMergeGrowthFacts } from '../analysis/GrowthFactValidator'
import { validateAndMergeMemoryFacts } from '../analysis/MemoryFactValidator'
import { ApplicationError } from '../errors/ApplicationError'
import type { AiAlgorithmApplicationService, AiAlgorithmTestStepExecution } from './AiAlgorithmApplicationService'

/** 测试成长资料使用的稳定证据 UUID，确保模型引用校验与生产链路一致。 */
const TEST_GROWTH_INPUT_ID = '00000000-0000-4000-8000-000000000001'
/** 成长和记忆第二步允许接收的第一步基线结构。 */
const learningTestBaselineSchema = z.array(z.object({
  type: z.literal('learning_prompt'),
  promptText: z.string().trim().min(1).max(20_000),
})).max(1)
/** 成长第二步允许接收的已校验原子结论结构。 */
const growthTestFactsSchema = z.array(modelGrowthAtomicFactSchema.extend({
  evidenceCount: z.number().int().positive(),
})).min(1).max(200)
/** 人物记忆第二步允许接收的程序校验后事实结构。 */
const memoryTestFactsSchema = z.array(z.object({
  statement: z.string().trim().min(1).max(20_000),
  memoryType: z.enum(['interest', 'judgment', 'experience', 'preference']),
  evidence: z.array(z.object({
    inputId: z.string().uuid(),
    signalType: z.enum(['external_record', 'user_feedback', 'user_decision', 'task_result']),
  })).min(1).max(200),
  independentEvidenceCount: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  conflicts: z.array(z.string().trim().min(1).max(1_000)).max(20),
})).min(1).max(200)

/** AI 固定算法只读测试服务依赖。 */
export interface AiAlgorithmTestApplicationServiceDependencies {
  /** 复用真实算法配置、模型连接、提示词渲染和执行能力。 */
  algorithms: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeTestStep'>
}

/** 以业务化输入执行固定算法，并返回不落库的逐步诊断。 */
export class AiAlgorithmTestApplicationService {
  /** @param dependencies 真实算法执行服务。 */
  constructor(private readonly dependencies: AiAlgorithmTestApplicationServiceDependencies) {}

  /**
   * 真实调用当前发布配置测试一个固定算法。
   * @param code 人物或世界的灵魂、成长或记忆算法编码。
   * @param input 与算法类别匹配的业务化测试输入。
   * @returns 当前请求指定步骤的完整诊断。
   * @remarks 成长算法由前端显式推进步骤；提示词草稿优先且不写入任何业务数据。
   */
  async run(code: AiAlgorithmCode, input: AiAlgorithmTestInput): Promise<AiAlgorithmTestResult> {
    if (code.startsWith('article_')) {
      throw new ApplicationError('OPERATION_NOT_SUPPORTED', '文章算法请通过工作台图文创作闭环测试', 409)
    }
    const snapshot = await this.dependencies.algorithms.prepare(code)
    if (code.endsWith('_soul')) return await this.runSoul(snapshot, input)
    if (!('stepKey' in input)) throw new ApplicationError('VALIDATION_FAILED', '学习算法测试输入无效', 400)
    if (code === 'persona_memory') {
      return input.stepKey === 'extract'
        ? await this.runMemoryExtract(snapshot, input)
        : await this.runMemorySynthesize(snapshot, input)
    }
    return input.stepKey === 'extract'
      ? await this.runGrowthExtract(snapshot, input)
      : await this.runGrowthSynthesize(snapshot, input)
  }

  /**
   * 执行灵魂整理的单步骤测试。
   * @param snapshot 当前发布算法配置快照。
   * @param input 待校验的测试输入。
   * @returns 单步骤测试诊断。
   */
  private async runSoul(snapshot: AiAlgorithmSnapshot, input: AiAlgorithmTestInput): Promise<AiAlgorithmTestResult> {
    if (!('soulText' in input)) throw new ApplicationError('VALIDATION_FAILED', '灵魂算法测试输入无效', 400)
    const variables = { promptTextJson: JSON.stringify(input.soulText) }
    const execution = await this.dependencies.algorithms.executeTestStep(
      snapshot, 'organize', variables, 'soul_prompt_analysis', 'json_object',
    )
    const step = this.parseStep(snapshot, execution, variables, (output) => normalizeSoulSnapshot(analyzedSoulPromptSchema.parse(output)), null)
    return this.result(snapshot, [step])
  }

  /**
   * 单独执行成长资料原子提取测试，并返回第二步所需数据。
   * @param snapshot 当前发布算法配置快照。
   * @param input 待校验的测试输入。
   * @returns 原子提取步骤诊断。
   */
  private async runGrowthExtract(snapshot: AiAlgorithmSnapshot, input: Extract<AiAlgorithmTestInput, { stepKey: 'extract' }>): Promise<AiAlgorithmTestResult> {
    const baseline = input.baselineText.length > 0 ? [{ type: 'learning_prompt', promptText: input.baselineText }] : []
    const inputs = [{
      id: TEST_GROWTH_INPUT_ID,
      inputType: 'growth_material',
      inputId: TEST_GROWTH_INPUT_ID,
      title: '算法测试成长资料',
      content: input.materialText,
      importance: 3,
      isNew: true,
    }]
    const extractVariables = { baselineJson: JSON.stringify(baseline), inputsJson: JSON.stringify(inputs) }
    const extractExecution = await this.dependencies.algorithms.executeTestStep(
      snapshot, 'extract', extractVariables, 'growth_atomic_facts', 'json_object',
    )
    let facts: ReturnType<typeof validateAndMergeGrowthFacts> | null = null
    const extractStep = this.parseStep(snapshot, extractExecution, extractVariables, (output) => {
      const extracted = modelGrowthExtractionResultSchema.parse(output)
      facts = validateAndMergeGrowthFacts(extracted.facts, inputs)
      return { facts }
    }, null)
    if (extractStep.status === 'succeeded' && facts !== null) {
      extractStep.nextStepInput = { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) }
    }
    return this.result(snapshot, [extractStep])
  }

  /**
   * 使用第一步返回且重新校验的延续数据单独执行成长综合测试。
   * @param snapshot 当前发布算法配置快照。
   * @param input 第一步配置版本与延续 JSON。
   * @returns 成长综合步骤诊断。
   */
  private async runGrowthSynthesize(
    snapshot: AiAlgorithmSnapshot,
    input: Extract<AiAlgorithmTestInput, { stepKey: 'synthesize' }>,
  ): Promise<AiAlgorithmTestResult> {
    if (snapshot.configurationVersion !== input.configurationVersion) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_CHANGED', '算法配置已变化，请重新执行第一步', 409)
    }
    const baseline = parseContinuationJson(input.baselineJson, learningTestBaselineSchema, '成长基线')
    const facts = parseContinuationJson(input.factsJson, growthTestFactsSchema, '原子结论')
    const variables = { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) }
    const execution = await this.dependencies.algorithms.executeTestStep(
      snapshot, 'synthesize', variables, 'learning_prompt', 'text',
    )
    const step = this.parseStep(snapshot, execution, variables, output => modelLearningPromptResultSchema.parse({
      promptText: output,
      summary: `AI 已依据 ${facts.length} 条去重原子结论生成完整提示词草稿。`,
    }), null)
    return this.result(snapshot, [step])
  }

  /**
   * 单独执行人物记忆证据提取测试，并用分隔后的独立第三方记录执行真实门槛校验。
   * @param snapshot 当前发布的人物记忆算法配置快照。
   * @param input 当前记忆基线和以分隔线划分的测试素材。
   * @returns 证据提取步骤诊断及第二步所需的已校验事实。
   */
  private async runMemoryExtract(
    snapshot: AiAlgorithmSnapshot,
    input: Extract<AiAlgorithmTestInput, { stepKey: 'extract' }>,
  ): Promise<AiAlgorithmTestResult> {
    const baseline = input.baselineText.length > 0 ? [{ type: 'learning_prompt', promptText: input.baselineText }] : []
    const inputs = splitMemoryTestMaterials(input.materialText).map((content, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      return {
        id,
        inputType: 'persona_external_record',
        inputId: id,
        title: `算法测试记忆素材 ${index + 1}`,
        content,
        importance: 3,
        isNew: true,
      }
    })
    const extractVariables = { baselineJson: JSON.stringify(baseline), inputsJson: JSON.stringify(inputs) }
    const extractExecution = await this.dependencies.algorithms.executeTestStep(
      snapshot, 'extract', extractVariables, 'memory_evidence_facts', 'json_object',
    )
    let facts: ReturnType<typeof validateAndMergeMemoryFacts> | null = null
    const extractStep = this.parseStep(snapshot, extractExecution, extractVariables, (output) => {
      const extracted = modelMemoryExtractionResultSchema.parse(output)
      facts = validateAndMergeMemoryFacts(extracted.facts, inputs)
      return { facts }
    }, null)
    if (extractStep.status === 'succeeded' && facts !== null) {
      extractStep.nextStepInput = { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) }
    }
    return this.result(snapshot, [extractStep])
  }

  /**
   * 使用第一步返回且重新校验的记忆事实单独执行完整提示词编译测试。
   * @param snapshot 当前发布的人物记忆算法配置快照。
   * @param input 第一阶段配置版本与延续 JSON。
   * @returns 记忆编译步骤诊断。
   */
  private async runMemorySynthesize(
    snapshot: AiAlgorithmSnapshot,
    input: Extract<AiAlgorithmTestInput, { stepKey: 'synthesize' }>,
  ): Promise<AiAlgorithmTestResult> {
    if (snapshot.configurationVersion !== input.configurationVersion) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_CHANGED', '算法配置已变化，请重新执行第一步', 409)
    }
    const baseline = parseContinuationJson(input.baselineJson, learningTestBaselineSchema, '记忆基线')
    const facts = parseContinuationJson(input.factsJson, memoryTestFactsSchema, '记忆事实')
    const variables = { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) }
    const execution = await this.dependencies.algorithms.executeTestStep(
      snapshot, 'synthesize', variables, 'learning_prompt', 'text',
    )
    const step = this.parseStep(snapshot, execution, variables, output => modelLearningPromptResultSchema.parse({
      promptText: output,
      summary: `AI 已依据 ${facts.length} 条达到独立证据门槛的记忆事实生成完整提示词草稿。`,
    }), null)
    return this.result(snapshot, [step])
  }

  /**
   * 把模型执行事实转换为包含业务解析状态的公开诊断步骤。
   * @param snapshot 当前算法快照。
   * @param execution 单步真实模型执行事实。
   * @param variables 本步实际模板变量。
   * @param parser 与生产链路一致的业务输出解析器。
   * @param nextStepInput 成功时传给下一步的数据。
   * @returns 成功或失败的完整步骤结果。
   */
  private parseStep(
    snapshot: AiAlgorithmSnapshot,
    execution: AiAlgorithmTestStepExecution,
    variables: Record<string, string>,
    parser: (output: unknown) => unknown,
    nextStepInput: unknown,
  ): AiAlgorithmTestStepResult {
    const definition = getAiAlgorithmDefinition(snapshot.algorithmCode).steps.find(step => step.key === execution.step.stepKey)!
    let parsedOutput: unknown = null
    let error = execution.error
    if (execution.response && error === null) {
      try {
        parsedOutput = parser(execution.response.structuredOutput)
      }
      catch (parseError: unknown) {
        error = parseError instanceof Error ? `模型响应未通过业务校验：${parseError.message}` : '模型响应未通过业务校验'
      }
    }
    const succeeded = error === null
    const usage = execution.response?.usage
    return {
      stepKey: execution.step.stepKey,
      stepName: definition.name,
      promptCode: execution.step.promptCode,
      promptSource: execution.prompt.source,
      promptVersion: execution.prompt.versionNo,
      modelDeploymentId: execution.step.modelDeploymentId,
      model: execution.step.model,
      endpointOrigin: new URL(execution.step.endpoint).origin,
      parameters: execution.step.parameters,
      variables,
      systemPrompt: execution.prompt.systemPrompt,
      userPrompt: execution.prompt.userPrompt,
      rawOutput: execution.rawOutput,
      parsedOutput,
      nextStepInput: succeeded ? nextStepInput : null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      durationMs: execution.durationMs,
      status: succeeded ? 'succeeded' : 'failed',
      error,
    }
  }

  /**
   * 汇总一次算法测试。
   * @param snapshot 当前测试算法快照。
   * @param steps 实际执行的步骤结果。
   * @returns 含配置版本和整体状态的公开结果。
   */
  private result(snapshot: AiAlgorithmSnapshot, steps: AiAlgorithmTestStepResult[]): AiAlgorithmTestResult {
    return {
      algorithmCode: snapshot.algorithmCode,
      configurationVersion: snapshot.configurationVersion,
      steps,
      succeeded: steps.length === 1 && steps[0]!.status === 'succeeded',
    }
  }
}

/**
 * 解析并校验前一步由服务端返回、后续由浏览器回传的延续 JSON。
 * @param value 待解析 JSON 文本。
 * @param schema 该延续数据的固定结构契约。
 * @param label 错误消息中的业务名称。
 * @returns 已完成结构校验的数据。
 */
function parseContinuationJson<T>(value: string, schema: ZodType<T>, label: string): T {
  try {
    return schema.parse(JSON.parse(value))
  }
  catch {
    throw new ApplicationError('VALIDATION_FAILED', `${label}延续数据无效，请重新执行第一步`, 400)
  }
}

/**
 * 将测试文本按独占一行的三个连字符拆分为独立第三方记忆证据。
 * @param materialText 用户输入的测试记忆素材。
 * @returns 去除首尾空白且至少包含一项的独立素材数组。
 */
function splitMemoryTestMaterials(materialText: string): string[] {
  return materialText.split(/\r?\n\s*---\s*\r?\n/u).map(item => item.trim()).filter(Boolean)
}
