import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAlgorithmApplicationService } from '../../server/application/aiConfiguration/AiAlgorithmApplicationService'
import type { AiCacheAffinityScheduler } from '../../server/application/aiConfiguration/AiCacheAffinityScheduler'
import { AiAlgorithmTestApplicationService } from '../../server/application/aiConfiguration/AiAlgorithmTestApplicationService'
import { AiConfigurationApplicationService } from '../../server/application/aiConfiguration/AiConfigurationApplicationService'
import { SystemAiSettingsApplicationService } from '../../server/application/systemAi/SystemAiSettingsApplicationService'
import { SqliteAiConfigurationRepository } from '../../server/infrastructure/database/SqliteAiConfigurationRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteSystemAiSettingsRepository } from '../../server/infrastructure/database/SqliteSystemAiSettingsRepository'
import { AesGcmSecretCipher } from '../../server/infrastructure/security/AesGcmSecretCipher'
import { createAiConnectionSchema, saveAiModelDeploymentSchema } from '../../shared/schemas/aiConfiguration'
import type { AiModelFactory, AiTextModelOptions } from '../../server/ports/AiModelFactory'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import { TextModelError } from '../../server/ports/TextModelPort'
import type { ImageModelPort, ImageModelRequest, ImageModelResponse } from '../../server/ports/ImageModelPort'
import type { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { createTestAiPromptService } from '../support/createTestAiPromptService'
import { ConservativeTokenCounter } from '../../server/infrastructure/model/ConservativeTokenCounter'
import { DEFAULT_TEXT_PARAMETERS } from '../../server/application/generation/GenerationApplicationService'

/** 当前测试独占的临时数据目录。 */
let directory: string
/** 当前测试独占的迁移后数据库。 */
let database: SqliteDatabase

/** 记录动态模型创建参数并返回固定响应的测试工厂。 */
class RecordingModelFactory implements AiModelFactory {
  /** 所有模型创建调用；用于确认密钥只在执行阶段解密。 */
  public readonly options: AiTextModelOptions[] = []
  /** 所有真实模型请求；用于验证步骤顺序和数据传递。 */
  public readonly requests: TextModelRequest[] = []
  /** 所有真实图片请求；用于验证图片算法按快照执行。 */
  public readonly imageRequests: ImageModelRequest[] = []
  /** 指定从零开始的请求序号抛出安全模型错误；为空时全部成功。 */
  public failAtRequestIndex: number | null = null

  /** @param options 动态模型参数。 @returns 返回固定成功结果的模型端口。 */
  createTextModel(options: AiTextModelOptions): TextModelPort {
    this.options.push(options)
    return new FixedTextModel(options, this)
  }

  /** @param options 动态图片模型参数。 @returns 返回固定图片结果的模型端口。 */
  createImageModel(options: AiTextModelOptions): ImageModelPort {
    this.options.push(options)
    return new FixedImageModel(options, this)
  }
}

/** 不联网的固定图片模型。 */
class FixedImageModel implements ImageModelPort {
  /** @param options 当前动态模型参数。 @param recorder 统一记录请求的工厂。 */
  constructor(private readonly options: AiTextModelOptions, private readonly recorder: RecordingModelFactory) {}

  /** @returns 当前图片模型的非敏感快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible_images' as const, model: this.options.model, endpointOrigin: new URL(this.options.endpoint).origin }
  }

  /** @param request 当前图片请求。 @returns 固定图片字节。 */
  async generate(request: ImageModelRequest): Promise<ImageModelResponse> {
    this.recorder.imageRequests.push(request)
    return { bytes: new Uint8Array([1, 2, 3]), declaredMediaType: 'image/png' }
  }
}

/** 不联网的固定文本模型。 */
class FixedTextModel implements TextModelPort {
  /**
   * @param options 当前动态模型参数。
   * @param recorder 统一记录请求并控制测试失败位置的工厂。
   */
  constructor(private readonly options: AiTextModelOptions, private readonly recorder: RecordingModelFactory) {}

  /** @returns 当前模型的非敏感快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible' as const, model: this.options.model, endpointOrigin: new URL(this.options.endpoint).origin }
  }

  /** @param request 当前模型请求。 @returns JSON 请求返回原子结论，文本请求返回 OK。 */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    const requestIndex = this.recorder.requests.length
    this.recorder.requests.push(request)
    if (this.recorder.failAtRequestIndex === requestIndex) {
      throw new TextModelError('PROVIDER_UNAVAILABLE', '测试模型暂时不可用', true)
    }
    const structuredOutput = request.responseFormat === 'text'
      ? 'OK'
      : request.responseSchemaName === 'soul_prompt_analysis'
        ? { promptText: '整理后的灵魂提示词' }
        : request.responseSchemaName === 'memory_evidence_facts'
          ? { facts: [{
              statement: '完成过一次人物关系校对。',
              memoryType: 'experience',
              evidence: [{ inputId: '00000000-0000-4000-8000-000000000001' }],
              confidence: 0.9,
              conflicts: [],
            }] }
          : { facts: [{ statement: '重视证据。', evidenceInputIds: ['00000000-0000-4000-8000-000000000001'], confidence: 0.9 }] }
    return {
      rawOutput: typeof structuredOutput === 'string' ? structuredOutput : JSON.stringify(structuredOutput),
      structuredOutput,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }
  }
}

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-ai-configuration-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  vi.unstubAllGlobals()
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('AI 接口、模型部署与算法配置', () => {
  it('接口地址只接受不携带凭据和查询参数的 HTTP(S) URL', () => {
    expect(() => createAiConnectionSchema.parse({
      name: '非法协议', endpoint: 'ftp://model.example/v1', apiKey: 'secret', isEnabled: true,
    })).toThrow('接口地址仅支持 HTTP 或 HTTPS')
    expect(() => createAiConnectionSchema.parse({
      name: '查询密钥', endpoint: 'https://model.example/v1?key=secret', apiKey: 'secret', isEnabled: true,
    })).toThrow('接口地址不能包含账号、密码、查询参数或片段')
  })

  it('加密保存密钥、编辑时保留原密文并只在检测阶段解密', async () => {
    const { service, modelFactory } = createServices()
    const connection = await service.createConnection({
      name: '主接口', protocol: 'openai_compatible', endpoint: 'https://model.example/v1',
      userAgent: 'RenYang-Integration/1.0', apiKey: 'secret-api-key', isEnabled: true,
    })

    const raw = database.getClient().prepare(`
      SELECT api_key_ciphertext FROM ai_connections WHERE id = ?
    `).get(connection.id) as { api_key_ciphertext: string }
    expect(raw.api_key_ciphertext).not.toContain('secret-api-key')
    expect(await service.listConnections()).toEqual([expect.objectContaining({ hasApiKey: true, userAgent: 'RenYang-Integration/1.0' })])
    expect(JSON.stringify(await service.listConnections())).not.toContain('apiKeyCiphertext')

    await service.updateConnection(connection.id, {
      name: '主接口（编辑）', protocol: 'openai_compatible', endpoint: 'https://model.example/v1', isEnabled: true,
    })
    expect((await service.listConnections())[0]!.userAgent).toBe('RenYang-Integration/1.0')
    expect((database.getClient().prepare(`SELECT api_key_ciphertext FROM ai_connections WHERE id = ?`).get(connection.id) as { api_key_ciphertext: string }).api_key_ciphertext)
      .toBe(raw.api_key_ciphertext)

    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '主文本模型', model: 'text-model', modality: 'text', isEnabled: true,
    })
    await expect(service.checkModelDeployment(deployment.id)).resolves.toEqual({
      healthy: true, message: '接口、凭据和文本模型均可用',
    })
    expect(modelFactory.options).toEqual([expect.objectContaining({
      apiKey: 'secret-api-key', model: 'text-model', userAgent: 'RenYang-Integration/1.0',
    })])
  })

  it('拒绝已移除的 reasoning effort 对象格式', () => {
    expect(saveAiModelDeploymentSchema.safeParse({
      connectionId: '00000000-0000-4000-8000-000000000001', name: '旧格式模型', model: 'test-model',
      modality: 'text', thinkingControl: 'reasoning_effort_object', isEnabled: true,
    }).success).toBe(false)
  })

  it('算法超时为零时继承模型默认值，正数仍显式覆盖', async () => {
    const { service, algorithms, modelFactory } = createServices()
    const connection = await service.createConnection({
      name: '超时配置接口', protocol: 'openai_compatible', endpoint: 'https://timeout.example/v1',
      apiKey: 'timeout-secret', isEnabled: true,
    })
    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '超时配置模型', model: 'timeout-model', modality: 'text',
      defaultTimeoutMs: 75_000, isEnabled: true,
    })
    expect(deployment.defaultTimeoutMs).toBe(75_000)

    await service.publishAlgorithmConfiguration('persona_soul', {
      steps: [{
        stepKey: 'organize', modelDeploymentId: deployment.id,
        parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 0 },
      }],
    })
    const inheritedSnapshot = await algorithms.prepare('persona_soul')
    expect(inheritedSnapshot.steps[0]?.parameters.timeoutMs).toBe(75_000)
    await algorithms.executeStep(
      inheritedSnapshot, 'organize', { promptTextJson: '"继承超时"' }, 'soul_prompt_analysis', 'json_object',
    )
    expect(modelFactory.requests.at(-1)?.parameters.timeoutMs).toBe(75_000)

    await service.publishAlgorithmConfiguration('persona_soul', {
      steps: [{
        stepKey: 'organize', modelDeploymentId: deployment.id,
        parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 30_000 },
      }],
    })
    const overriddenSnapshot = await algorithms.prepare('persona_soul')
    expect(overriddenSnapshot.steps[0]?.parameters.timeoutMs).toBe(30_000)
  })

  it('把关闭思考格式和零输出 Token 固定到文本算法步骤快照', async () => {
    const { service, algorithms, modelFactory } = createServices()
    const connection = await service.createConnection({
      name: '思考控制接口', protocol: 'openai_compatible', endpoint: 'https://thinking.example/v1',
      apiKey: 'thinking-secret', isEnabled: true,
    })
    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '可关闭思考模型', model: 'thinking-model', modality: 'text',
      thinkingControl: 'reasoning_effort', isEnabled: true,
    })
    await service.publishAlgorithmConfiguration('persona_soul', {
      steps: [{
        stepKey: 'organize', modelDeploymentId: deployment.id,
        parameters: { temperature: 0.4, maxOutputTokens: 0, timeoutMs: 60_000, disableThinking: true },
      }],
    })

    const snapshot = await algorithms.prepare('persona_soul')
    expect(snapshot.steps).toEqual([expect.objectContaining({
      modelDeploymentId: deployment.id,
      thinkingDisableMode: 'reasoning_effort',
      parameters: expect.objectContaining({ maxOutputTokens: 0, disableThinking: true }),
    })])
    await algorithms.executeStep(snapshot, 'organize', { promptTextJson: '"整理资料"' }, 'soul_prompt_analysis', 'json_object')
    expect(modelFactory.requests).toEqual([expect.objectContaining({
      thinkingDisableMode: 'reasoning_effort',
      parameters: expect.objectContaining({ maxOutputTokens: 0 }),
    })])
  })

  it('关闭思考时拒绝未声明供应商请求格式的文本模型', async () => {
    const { service } = createServices()
    const connection = await service.createConnection({
      name: '无思考控制接口', protocol: 'openai_compatible', endpoint: 'https://no-thinking.example/v1',
      apiKey: 'no-thinking-secret', isEnabled: true,
    })
    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '普通文本模型', model: 'plain-model', modality: 'text', isEnabled: true,
    })

    await expect(service.publishAlgorithmConfiguration('persona_soul', {
      steps: [{
        stepKey: 'organize', modelDeploymentId: deployment.id,
        parameters: { temperature: 0.4, maxOutputTokens: 0, timeoutMs: 60_000, disableThinking: true },
      }],
    })).rejects.toMatchObject({ code: 'AI_THINKING_CONTROL_NOT_CONFIGURED', statusCode: 422 })
  })

  it('固定步骤发布不可变配置版本并按快照选择不同端点模型执行', async () => {
    const { service, algorithms, modelFactory } = createServices()
    const connection = await service.createConnection({
      name: '成长接口', protocol: 'openai_compatible', endpoint: 'https://growth.example/v1',
      apiKey: 'growth-secret', isEnabled: true,
    })
    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '成长文本模型', model: 'growth-model', modality: 'text', isEnabled: true,
    })
    const steps = [
      { stepKey: 'extract', modelDeploymentId: deployment.id, parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 } },
      { stepKey: 'synthesize', modelDeploymentId: deployment.id, parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 } },
    ]

    await service.publishAlgorithmConfiguration('persona_growth', { steps })
    await service.publishAlgorithmConfiguration('persona_growth', { steps })
    const view = (await service.listAlgorithms()).find(item => item.code === 'persona_growth')!
    expect(view).toMatchObject({ activeConfigurationVersion: 2, configurationVersionCount: 2 })
    expect(view.steps.map(step => step.key)).toEqual(['extract', 'synthesize'])

    const snapshot = await algorithms.prepare('persona_growth')
    expect(snapshot).toMatchObject({ implementationVersion: 1, configurationVersion: 2 })
    expect(JSON.stringify(snapshot)).not.toContain('growth-secret')
    await algorithms.executeStep(snapshot, 'extract', {
      baselineJson: '[]', inputsJson: '[]',
    }, 'growth_atomic_facts', 'json_object')
    expect(modelFactory.options.at(-1)).toEqual({
      endpoint: 'https://growth.example/v1', apiKey: 'growth-secret', model: 'growth-model',
      userAgent: '',
    })
    expect(database.getClient().prepare(`
      SELECT action FROM audit_events WHERE target_id = 'persona_growth' ORDER BY created_at DESC LIMIT 1
    `).get()).toEqual({ action: 'ai_algorithm_configuration_published' })
  })

  it('配置编辑或停用后旧任务仍使用原模型快照和当前密钥执行', async () => {
    const { service, algorithms, modelFactory } = createServices()
    const connection = await service.createConnection({
      name: '快照接口', protocol: 'openai_compatible', endpoint: 'https://snapshot.example/v1',
      userAgent: 'Snapshot/1.0', apiKey: 'snapshot-secret', isEnabled: true,
    })
    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '快照模型', model: 'snapshot-model', modality: 'text', isEnabled: true,
    })
    await service.publishAlgorithmConfiguration('persona_soul', {
      steps: [{
        stepKey: 'organize', modelDeploymentId: deployment.id,
        parameters: { temperature: 0.2, maxOutputTokens: 2_048, timeoutMs: 30_000 },
      }],
    })
    const snapshot = await algorithms.prepare('persona_soul')

    await service.updateConnection(connection.id, {
      name: '已编辑快照接口', protocol: 'openai_compatible', endpoint: 'https://changed.example/v1',
      userAgent: 'Changed/2.0', apiKey: 'rotated-secret', isEnabled: false,
    })
    await service.updateModelDeployment(deployment.id, {
      connectionId: connection.id, name: '已编辑快照模型', model: 'changed-model', modality: 'text', isEnabled: false,
    })

    await algorithms.executeStep(snapshot, 'organize', { promptTextJson: '"旧任务"' }, 'soul_prompt_analysis', 'json_object')
    expect(modelFactory.options.at(-1)).toEqual({
      endpoint: 'https://snapshot.example/v1', apiKey: 'rotated-secret', model: 'snapshot-model',
      userAgent: 'Snapshot/1.0',
    })
  })

  it('文本调用按实际系统提示词进入缓存亲和队列且诊断调用绕过队列', async () => {
    const affinityKeys: string[] = []
    const cacheAffinityScheduler: Pick<AiCacheAffinityScheduler, 'run'> = {
      /** @param key 统一算法服务生成的亲和键。 @param operation 实际模型调用。 @returns 模型调用结果。 */
      async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        affinityKeys.push(key)
        return await operation()
      },
    }
    const { service, algorithms, modelFactory } = createServices(cacheAffinityScheduler)
    await configureSoulAlgorithm(service)
    const snapshot = await algorithms.prepare('persona_soul')

    await algorithms.executeStep(
      snapshot, 'organize', { promptTextJson: '"第一次输入"' }, 'soul_prompt_analysis', 'json_object',
      { useCacheAffinity: true },
    )
    await algorithms.executeStep(
      snapshot, 'organize', { promptTextJson: '"变化后的输入"' }, 'soul_prompt_analysis', 'json_object',
      { useCacheAffinity: true },
    )
    await algorithms.executeTestStep(
      snapshot, 'organize', { promptTextJson: '"后台诊断"' }, 'soul_prompt_analysis', 'json_object',
    )

    expect(affinityKeys).toHaveLength(2)
    expect(affinityKeys[0]).toBe(affinityKeys[1])
    expect(modelFactory.requests[0]?.promptCacheKey).toBe(affinityKeys[0])
    expect(modelFactory.requests[1]?.promptCacheKey).toBe(affinityKeys[1])
    expect(modelFactory.requests[2]?.promptCacheKey).toBeUndefined()
  })

  it('结构校验首次失败时保持系统提示不变并仅修正用户消息', async () => {
    const { service, algorithms, modelFactory } = createServices()
    await configureSoulAlgorithm(service)
    const snapshot = await algorithms.prepare('persona_soul')
    let validations = 0

    const response = await algorithms.executeStep(
      snapshot,
      'organize',
      { promptTextJson: '"需要整理的资料"' },
      'soul_prompt_analysis',
      'json_object',
      {
        useCacheAffinity: true,
        limits: { ...DEFAULT_TEXT_PARAMETERS },
        priorUsage: null,
        validateStructuredOutput: () => {
          validations += 1
          if (validations === 1) throw new Error('缺少必需字段 promptText')
        },
      },
    )

    expect(modelFactory.requests).toHaveLength(2)
    expect(modelFactory.requests[0]?.systemPrompt).toBe(modelFactory.requests[1]?.systemPrompt)
    expect(modelFactory.requests[1]?.userPrompt).not.toBe(modelFactory.requests[0]?.userPrompt)
    expect(modelFactory.requests[1]?.userPrompt).toContain('结构修正要求')
    expect(response.usage).toEqual({ inputTokens: 2, outputTokens: 2, totalTokens: 4 })
  })

  it('配置算法在供应商调用前拒绝超过运行快照的最终提示', async () => {
    const { service, algorithms, modelFactory } = createServices()
    await configureSoulAlgorithm(service)
    const snapshot = await algorithms.prepare('persona_soul')

    await expect(algorithms.executeStep(
      snapshot,
      'organize',
      { promptTextJson: JSON.stringify('超长输入'.repeat(10_000)) },
      'soul_prompt_analysis',
      'json_object',
      {
        limits: { ...DEFAULT_TEXT_PARAMETERS },
        priorUsage: null,
      },
    )).rejects.toMatchObject({ code: 'PROMPT_BUDGET_EXCEEDED', statusCode: 422 })
    expect(modelFactory.requests).toHaveLength(0)
  })

  it('文章生成与文章配图分析作为两个独立固定算法配置', async () => {
    const { service, algorithms } = createServices()
    const connection = await service.createConnection({
      name: '文章接口', protocol: 'openai_compatible', endpoint: 'https://article.example/v1',
      apiKey: 'article-secret', isEnabled: true,
    })
    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '文章文本模型', model: 'article-model', modality: 'text', isEnabled: true,
    })

    const views = await service.listAlgorithms()
    expect(views.map(item => item.code)).toEqual(expect.arrayContaining(['article_generation', 'article_image_analysis']))
    expect(views.find(item => item.code === 'article_generation')?.stepDefinitions).toEqual([
      expect.objectContaining({ key: 'generate', promptCode: 'generation.article', ordinal: 0 }),
    ])
    expect(views.find(item => item.code === 'article_image_analysis')?.stepDefinitions).toEqual([
      expect.objectContaining({ key: 'analyze', promptCode: 'generation.article_images', ordinal: 0 }),
    ])

    await service.publishAlgorithmConfiguration('article_generation', {
      steps: [{
        stepKey: 'generate', modelDeploymentId: deployment.id,
        parameters: { temperature: 0.6, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      }],
    })
    await service.publishAlgorithmConfiguration('article_image_analysis', {
      steps: [{
        stepKey: 'analyze', modelDeploymentId: deployment.id,
        parameters: { temperature: 0.2, maxOutputTokens: 2_048, timeoutMs: 30_000 },
      }],
    })

    await expect(algorithms.prepare('article_generation')).resolves.toMatchObject({
      algorithmCode: 'article_generation', steps: [{ stepKey: 'generate', promptCode: 'generation.article' }],
    })
    await expect(algorithms.prepare('article_image_analysis')).resolves.toMatchObject({
      algorithmCode: 'article_image_analysis', steps: [{ stepKey: 'analyze', promptCode: 'generation.article_images' }],
    })
  })

  it('算法步骤未选择模型时使用同类型默认模型，显式绑定始终优先', async () => {
    const { service, algorithms, defaultModels } = createServices()
    const connection = await service.createConnection({
      name: '默认模型接口', protocol: 'openai_compatible', endpoint: 'https://defaults.example/v1',
      apiKey: 'default-secret', isEnabled: true,
    })
    const defaultDeployment = await service.createModelDeployment({
      connectionId: connection.id, name: '默认文本模型', model: 'default-text', modality: 'text', isEnabled: true,
    })
    const explicitDeployment = await service.createModelDeployment({
      connectionId: connection.id, name: '专用文本模型', model: 'explicit-text', modality: 'text', isEnabled: true,
    })
    await defaultModels.updateSettings({ textModelDeploymentId: defaultDeployment.id, imageModelDeploymentId: '' })

    await service.publishAlgorithmConfiguration('article_generation', {
      steps: [{
        stepKey: 'generate', modelDeploymentId: '',
        parameters: { temperature: 0.6, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      }],
    })
    await expect(algorithms.prepare('article_generation')).resolves.toMatchObject({
      steps: [{ modelDeploymentId: defaultDeployment.id, model: 'default-text' }],
    })

    await service.publishAlgorithmConfiguration('article_generation', {
      steps: [{
        stepKey: 'generate', modelDeploymentId: explicitDeployment.id,
        parameters: { temperature: 0.6, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      }],
    })
    await expect(algorithms.prepare('article_generation')).resolves.toMatchObject({
      steps: [{ modelDeploymentId: explicitDeployment.id, model: 'explicit-text' }],
    })
  })

  it('算法步骤和默认设置都没有模型时返回明确的能力错误', async () => {
    const { service, algorithms } = createServices()
    await service.publishAlgorithmConfiguration('article_generation', {
      steps: [{
        stepKey: 'generate', modelDeploymentId: '',
        parameters: { temperature: 0.6, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      }],
    })

    await expect(algorithms.prepare('article_generation')).rejects.toMatchObject({
      code: 'CAPABILITY_DISABLED',
      statusCode: 422,
    })
  })

  it('成长测试分步执行并把第一步已校验事实显式传给第二步', async () => {
    const { service, testing, prompts, modelFactory } = createServices()
    const deploymentId = await configureAlgorithm(service, 'persona_growth')
    const workspace = (await prompts.listWorkspaces()).find(item => item.code === 'analysis.persona_growth_extract')!
    await prompts.saveDraft(workspace.code, {
      baseVersionId: workspace.activeVersion!.id,
      systemPromptTemplate: `测试草稿系统规则\n${workspace.activeVersion!.systemPromptTemplate ?? ''}`,
      userPromptTemplate: workspace.activeVersion!.userPromptTemplate,
      changeSummary: '验证草稿优先测试',
    })

    const extractResult = await testing.run('persona_growth', {
      stepKey: 'extract', baselineText: '当前成长基线', materialText: '新的资料事实',
    })

    expect(extractResult).toMatchObject({ algorithmCode: 'persona_growth', configurationVersion: 1, succeeded: true })
    expect(extractResult.steps).toHaveLength(1)
    expect(extractResult.steps[0]).toMatchObject({
      stepKey: 'extract', promptSource: 'draft', promptVersion: null, modelDeploymentId: deploymentId,
      status: 'succeeded', rawOutput: expect.stringContaining('重视证据'),
      parsedOutput: { facts: [expect.objectContaining({ statement: '重视证据。', evidenceCount: 1 })] },
    })
    expect(extractResult.steps[0]!.systemPrompt).toContain('测试草稿系统规则')
    expect(modelFactory.requests).toHaveLength(1)
    const continuation = extractResult.steps[0]!.nextStepInput as { baselineJson: string, factsJson: string }
    expect(continuation).toEqual(expect.objectContaining({ factsJson: expect.stringContaining('重视证据。') }))

    const synthesizeResult = await testing.run('persona_growth', {
      stepKey: 'synthesize', configurationVersion: extractResult.configurationVersion, ...continuation,
    })

    expect(synthesizeResult).toMatchObject({ succeeded: true, configurationVersion: 1 })
    expect(synthesizeResult.steps).toEqual([expect.objectContaining({
      stepKey: 'synthesize', promptSource: 'published', status: 'succeeded',
    })])
    expect(modelFactory.requests).toHaveLength(2)
    expect(modelFactory.requests[1]!.userPrompt).toContain('重视证据。')
  })

  it('成长测试第一步调用失败后不执行第二步', async () => {
    const { service, testing, modelFactory } = createServices()
    await configureAlgorithm(service, 'world_growth')
    modelFactory.failAtRequestIndex = 0

    const result = await testing.run('world_growth', {
      stepKey: 'extract', baselineText: '世界当前基线', materialText: '世界新增资料',
    })

    expect(result.succeeded).toBe(false)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({ stepKey: 'extract', status: 'failed', error: '测试模型暂时不可用' })
    expect(modelFactory.requests).toHaveLength(1)
  })

  it('人物记忆测试使用专用证据结构、程序门槛和两阶段延续数据', async () => {
    const { service, testing, modelFactory } = createServices()
    await configureAlgorithm(service, 'persona_memory')

    const extractResult = await testing.run('persona_memory', {
      stepKey: 'extract', baselineText: '当前记忆基线', materialText: '完成过一次人物关系校对。',
    })

    expect(extractResult).toMatchObject({ algorithmCode: 'persona_memory', succeeded: true })
    expect(extractResult.steps[0]).toMatchObject({
      stepKey: 'extract', status: 'succeeded',
      parsedOutput: { facts: [expect.objectContaining({
        memoryType: 'experience', independentEvidenceCount: 1,
        evidence: [{ inputId: '00000000-0000-4000-8000-000000000001', signalType: 'external_record' }],
      })] },
    })
    const continuation = extractResult.steps[0]!.nextStepInput as { baselineJson: string, factsJson: string }
    expect(continuation.factsJson).toContain('independentEvidenceCount')

    const synthesizeResult = await testing.run('persona_memory', {
      stepKey: 'synthesize', configurationVersion: extractResult.configurationVersion, ...continuation,
    })
    expect(synthesizeResult).toMatchObject({ succeeded: true, steps: [{ stepKey: 'synthesize', status: 'succeeded' }] })
    expect(modelFactory.requests).toHaveLength(2)
    expect(modelFactory.requests[1]!.userPrompt).toContain('完成过一次人物关系校对')
  })

  it('灵魂测试无草稿时使用发布版并返回实际单步提示词和用量', async () => {
    const { service, testing, modelFactory } = createServices()
    await configureSoulAlgorithm(service)

    const result = await testing.run('persona_soul', { soulText: '坚持独立判断，不虚构事实。' })

    expect(result).toMatchObject({ algorithmCode: 'persona_soul', succeeded: true })
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({
      stepKey: 'organize', promptSource: 'published', promptVersion: expect.any(Number),
      parsedOutput: { promptText: '整理后的灵魂提示词' },
      inputTokens: 1, outputTokens: 1, totalTokens: 2, status: 'succeeded',
    })
    expect(result.steps[0]!.userPrompt).toContain('坚持独立判断')
    expect(modelFactory.requests).toHaveLength(1)
  })

  it('图片算法只接受图片部署并按固定快照执行', async () => {
    const { service, algorithms, modelFactory } = createServices()
    const connection = await service.createConnection({
      name: '内容与视觉接口', protocol: 'openai_compatible', endpoint: 'https://image-algorithm.test/v1',
      userAgent: 'RenYang-Configured/1.0', apiKey: 'database-model-key', isEnabled: true,
    })
    const textDeployment = await service.createModelDeployment({
      connectionId: connection.id, name: '文本部署', model: 'database-text-model', modality: 'text', isEnabled: true,
    })
    const imageDeployment = await service.createModelDeployment({
      connectionId: connection.id, name: '头像图片', model: 'database-image-model', modality: 'image', isEnabled: true,
    })
    const parameters = { temperature: 0, maxOutputTokens: 64, timeoutMs: 30_000, maxImageWidth: 1_024, maxImageHeight: 768 }
    await expect(service.publishAlgorithmConfiguration('persona_avatar', {
      steps: [{ stepKey: 'generate', modelDeploymentId: textDeployment.id, parameters }],
    })).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await service.publishAlgorithmConfiguration('persona_avatar', {
      steps: [{ stepKey: 'generate', modelDeploymentId: imageDeployment.id, parameters }],
    })

    const snapshot = await algorithms.prepare('persona_avatar')
    await algorithms.executeImageStep(snapshot, 'generate', {
      nameJson: '"林默"', soulPromptJson: '"谨慎、冷静"', additionalPromptJson: '"暖色背景"',
    }, '1:1')

    expect(snapshot.steps[0]).toMatchObject({
      modality: 'image', model: 'database-image-model', parameters: { maxImageWidth: 1_024, maxImageHeight: 768 },
    })
    expect(modelFactory.options.at(-1)).toMatchObject({
      endpoint: 'https://image-algorithm.test/v1', apiKey: 'database-model-key', model: 'database-image-model',
      userAgent: 'RenYang-Configured/1.0',
    })
    expect(modelFactory.imageRequests).toEqual([
      expect.objectContaining({ aspectRatio: '1:1', maxWidth: 1_024, maxHeight: 768, timeoutMs: 30_000, prompt: expect.stringContaining('林默') }),
    ])
  })
})

/**
 * 创建连接和文本部署，并发布人物灵魂算法的单步骤配置。
 * @param service 真实 AI 配置应用服务。
 * @returns 配置发布完成时结束。
 */
async function configureSoulAlgorithm(service: AiConfigurationApplicationService): Promise<void> {
  const connection = await service.createConnection({
    name: '灵魂测试接口', protocol: 'openai_compatible', endpoint: 'https://soul.example/v1',
    apiKey: 'soul-secret', isEnabled: true,
  })
  const deployment = await service.createModelDeployment({
    connectionId: connection.id, name: '灵魂测试模型', model: 'soul-model', modality: 'text', isEnabled: true,
  })
  await service.publishAlgorithmConfiguration('persona_soul', {
    steps: [{
      stepKey: 'organize', modelDeploymentId: deployment.id,
      parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
    }],
  })
}

/**
 * 创建连接和文本部署，并发布指定成长或记忆算法的完整配置。
 * @param service 真实 AI 配置应用服务。
 * @param code 人物成长、世界成长或人物记忆算法编码。
 * @returns 新建文本模型部署 UUID。
 */
async function configureAlgorithm(
  service: AiConfigurationApplicationService,
  code: 'persona_growth' | 'world_growth' | 'persona_memory',
): Promise<string> {
  const connection = await service.createConnection({
    name: '算法测试接口', protocol: 'openai_compatible', endpoint: 'https://test.example/v1',
    apiKey: 'test-secret', isEnabled: true,
  })
  const deployment = await service.createModelDeployment({
    connectionId: connection.id, name: '算法测试模型', model: 'test-model', modality: 'text', isEnabled: true,
  })
  await service.publishAlgorithmConfiguration(code, {
    steps: [
      { stepKey: 'extract', modelDeploymentId: deployment.id, parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 } },
      { stepKey: 'synthesize', modelDeploymentId: deployment.id, parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 } },
    ],
  })
  return deployment.id
}

/**
 * 使用真实数据库、提示词与加密器创建配置管理和算法执行服务。
 * @param cacheAffinityScheduler 可选的缓存亲和调度观察器。
 * @returns 两个应用服务及可观察模型工厂。
 */
function createServices(cacheAffinityScheduler?: Pick<AiCacheAffinityScheduler, 'run'>): {
  service: AiConfigurationApplicationService
  algorithms: AiAlgorithmApplicationService
  testing: AiAlgorithmTestApplicationService
  prompts: AiPromptApplicationService
  modelFactory: RecordingModelFactory
  defaultModels: SystemAiSettingsApplicationService
  repository: SqliteAiConfigurationRepository
  secretCipher: AesGcmSecretCipher
} {
  const repository = new SqliteAiConfigurationRepository(database.getClient())
  const secretCipher = new AesGcmSecretCipher('x'.repeat(32))
  const modelFactory = new RecordingModelFactory()
  const identifiers = { create: () => randomUUID() }
  const clock = { now: () => 9_000 }
  const prompts = createTestAiPromptService(database, identifiers, clock)
  const defaultModelsRepository = new SqliteSystemAiSettingsRepository(database.getClient())
  const defaultModels = new SystemAiSettingsApplicationService({
    repository: defaultModelsRepository,
    aiConfiguration: repository,
    clock,
  })
  const algorithms = new AiAlgorithmApplicationService({
    repository, defaultModels: defaultModelsRepository, secretCipher, modelFactory, prompts,
    tokenCounter: new ConservativeTokenCounter(), cacheAffinityScheduler,
  })
  return {
    service: new AiConfigurationApplicationService({ repository, secretCipher, modelFactory, prompts, identifiers, clock }),
    algorithms,
    testing: new AiAlgorithmTestApplicationService({ algorithms }),
    prompts,
    modelFactory,
    defaultModels,
    repository,
    secretCipher,
  }
}
