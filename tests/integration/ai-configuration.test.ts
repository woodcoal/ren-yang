import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAlgorithmApplicationService } from '../../server/application/aiConfiguration/AiAlgorithmApplicationService'
import { AiAlgorithmTestApplicationService } from '../../server/application/aiConfiguration/AiAlgorithmTestApplicationService'
import { AiConfigurationApplicationService } from '../../server/application/aiConfiguration/AiConfigurationApplicationService'
import { DEFAULT_SYSTEM_AI_SETTINGS, SystemAiSettingsApplicationService } from '../../server/application/systemAi/SystemAiSettingsApplicationService'
import { SqliteAiConfigurationRepository } from '../../server/infrastructure/database/SqliteAiConfigurationRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteSystemAiSettingsRepository } from '../../server/infrastructure/database/SqliteSystemAiSettingsRepository'
import { SqliteConfiguredImageModel, SqliteConfiguredTextModel } from '../../server/infrastructure/models/SqliteConfiguredModels'
import { AesGcmSecretCipher } from '../../server/infrastructure/security/AesGcmSecretCipher'
import type { AiModelFactory, AiTextModelOptions } from '../../server/ports/AiModelFactory'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import { TextModelError } from '../../server/ports/TextModelPort'
import type { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { createTestAiPromptService } from '../support/createTestAiPromptService'

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
  /** 指定从零开始的请求序号抛出安全模型错误；为空时全部成功。 */
  public failAtRequestIndex: number | null = null

  /** @param options 动态模型参数。 @returns 返回固定成功结果的模型端口。 */
  createTextModel(options: AiTextModelOptions): TextModelPort {
    this.options.push(options)
    return new FixedTextModel(options, this)
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
              evidence: [{ inputId: '00000000-0000-4000-8000-000000000001', signalType: 'external_record' }],
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

  it('系统默认文本和图片模型在数据库保存后立即使用对应端点、密钥、模型与 UserAgent', async () => {
    const { service, repository, secretCipher } = createServices()
    const connection = await service.createConnection({
      name: '内容与视觉接口', protocol: 'openai_compatible', endpoint: 'https://default-models.test/v1',
      userAgent: 'RenYang-Configured/1.0', apiKey: 'database-model-key', isEnabled: true,
    })
    const textDeployment = await service.createModelDeployment({
      connectionId: connection.id, name: '默认文本', model: 'database-text-model', modality: 'text', isEnabled: true,
    })
    const imageDeployment = await service.createModelDeployment({
      connectionId: connection.id, name: '默认图片', model: 'database-image-model', modality: 'image', isEnabled: true,
    })
    const systemSettings = new SystemAiSettingsApplicationService({
      repository: new SqliteSystemAiSettingsRepository(database.getClient()),
      aiConfiguration: repository,
      clock: { now: () => 9_100 },
    })
    const textModel = new SqliteConfiguredTextModel(database.getClient(), secretCipher)
    const imageModel = new SqliteConfiguredImageModel(database.getClient(), secretCipher)

    expect(textModel.getConfiguredModel()).toBeNull()
    expect(imageModel.getConfiguredModel()).toBeNull()
    await systemSettings.updateSettings({
      ...DEFAULT_SYSTEM_AI_SETTINGS,
      textModelDeploymentId: textDeployment.id,
      imageModelDeploymentId: imageDeployment.id,
    })
    expect(textModel.getConfiguredModel()).toMatchObject({ model: 'database-text-model', endpointOrigin: 'https://default-models.test' })
    expect(imageModel.getConfiguredModel()).toMatchObject({ model: 'database-image-model', endpointOrigin: 'https://default-models.test' })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString('base64') }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await textModel.generateStructured({
      systemPrompt: '系统规则', userPrompt: '用户任务', responseSchemaName: 'configured_model_test',
      parameters: {
        temperature: 0.2, maxOutputTokens: 256, timeoutMs: 5_000,
        maxEvidenceChunks: 1, maxTextBlocks: 1, maxImageBlocks: 0,
        maxPromptCharacters: 10_000, maxTotalTokens: 2_000, maxBlockAttempts: 1,
      },
    })
    await imageModel.generate({ prompt: '测试图片', aspectRatio: '1:1', timeoutMs: 5_000 })

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'https://default-models.test/v1/chat/completions',
      'https://default-models.test/v1/images/generations',
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer database-model-key',
        'user-agent': 'RenYang-Configured/1.0',
      })
    }
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({ model: 'database-text-model' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toMatchObject({ model: 'database-image-model' })
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
 * @returns 两个应用服务及可观察模型工厂。
 */
function createServices(): {
  service: AiConfigurationApplicationService
  algorithms: AiAlgorithmApplicationService
  testing: AiAlgorithmTestApplicationService
  prompts: AiPromptApplicationService
  modelFactory: RecordingModelFactory
  repository: SqliteAiConfigurationRepository
  secretCipher: AesGcmSecretCipher
} {
  const repository = new SqliteAiConfigurationRepository(database.getClient())
  const secretCipher = new AesGcmSecretCipher('x'.repeat(32))
  const modelFactory = new RecordingModelFactory()
  const identifiers = { create: () => randomUUID() }
  const clock = { now: () => 9_000 }
  const prompts = createTestAiPromptService(database, identifiers, clock)
  const algorithms = new AiAlgorithmApplicationService({ repository, secretCipher, modelFactory, prompts })
  return {
    service: new AiConfigurationApplicationService({ repository, secretCipher, modelFactory, prompts, identifiers, clock }),
    algorithms,
    testing: new AiAlgorithmTestApplicationService({ algorithms }),
    prompts,
    modelFactory,
    repository,
    secretCipher,
  }
}
