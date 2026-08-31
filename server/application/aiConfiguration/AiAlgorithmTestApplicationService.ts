import { modelGrowthExtractionResultSchema, modelLearningPromptResultSchema } from '../../../shared/schemas/analysis'
import type { AiAlgorithmTestInput } from '../../../shared/schemas/aiAlgorithmTest'
import { analyzedSoulPromptSchema } from '../../../shared/schemas/content'
import type { AiAlgorithmTestResult, AiAlgorithmTestStepResult } from '../../../shared/types/aiAlgorithmTest'
import type { AiAlgorithmCode } from '../../../shared/types/aiConfiguration'
import { getAiAlgorithmDefinition } from '../../domain/ai/AiAlgorithmDefinitions'
import { normalizeSoulSnapshot } from '../../domain/content/SoulRules'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { validateAndMergeGrowthFacts } from '../analysis/GrowthFactValidator'
import { ApplicationError } from '../errors/ApplicationError'
import type { AiAlgorithmApplicationService, AiAlgorithmTestStepExecution } from './AiAlgorithmApplicationService'

/** 测试成长资料使用的稳定证据 UUID，确保模型引用校验与生产链路一致。 */
const TEST_GROWTH_INPUT_ID = '00000000-0000-4000-8000-000000000001'

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
   * @param code 人物或世界的灵魂、成长算法编码。
   * @param input 与算法类别匹配的业务化测试输入。
   * @returns 按实际执行顺序生成的完整逐步诊断。
   * @remarks 提示词草稿优先；失败后立即停止；不写入任何业务数据。
   */
  async run(code: AiAlgorithmCode, input: AiAlgorithmTestInput): Promise<AiAlgorithmTestResult> {
    const snapshot = await this.dependencies.algorithms.prepare(code)
    if (code.endsWith('_soul')) return await this.runSoul(snapshot, input)
    return await this.runGrowth(snapshot, input)
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
   * 依次执行成长资料原子提取与提示词综合测试。
   * @param snapshot 当前发布算法配置快照。
   * @param input 待校验的测试输入。
   * @returns 一步失败即停止的逐步测试诊断。
   */
  private async runGrowth(snapshot: AiAlgorithmSnapshot, input: AiAlgorithmTestInput): Promise<AiAlgorithmTestResult> {
    if (!('baselineText' in input)) throw new ApplicationError('VALIDATION_FAILED', '成长算法测试输入无效', 400)
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
    if (extractStep.status === 'failed' || facts === null) return this.result(snapshot, [extractStep])

    const synthesizeVariables = { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) }
    extractStep.nextStepInput = synthesizeVariables
    const synthesizeExecution = await this.dependencies.algorithms.executeTestStep(
      snapshot, 'synthesize', synthesizeVariables, 'learning_prompt', 'text',
    )
    const synthesizeStep = this.parseStep(snapshot, synthesizeExecution, synthesizeVariables, output => modelLearningPromptResultSchema.parse({
      promptText: output,
      summary: `AI 已依据 ${facts!.length} 条去重原子结论生成完整提示词草稿。`,
    }), null)
    return this.result(snapshot, [extractStep, synthesizeStep])
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
      succeeded: steps.length === getAiAlgorithmDefinition(snapshot.algorithmCode).steps.length
        && steps.every(step => step.status === 'succeeded'),
    }
  }
}
