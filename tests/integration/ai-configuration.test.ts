import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AiAlgorithmApplicationService } from '../../server/application/aiConfiguration/AiAlgorithmApplicationService'
import { AiConfigurationApplicationService } from '../../server/application/aiConfiguration/AiConfigurationApplicationService'
import { SqliteAiConfigurationRepository } from '../../server/infrastructure/database/SqliteAiConfigurationRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { AesGcmSecretCipher } from '../../server/infrastructure/security/AesGcmSecretCipher'
import type { AiModelFactory, AiTextModelOptions } from '../../server/ports/AiModelFactory'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import { createTestAiPromptService } from '../support/createTestAiPromptService'

/** 当前测试独占的临时数据目录。 */
let directory: string
/** 当前测试独占的迁移后数据库。 */
let database: SqliteDatabase

/** 记录动态模型创建参数并返回固定响应的测试工厂。 */
class RecordingModelFactory implements AiModelFactory {
  /** 所有模型创建调用；用于确认密钥只在执行阶段解密。 */
  public readonly options: AiTextModelOptions[] = []

  /** @param options 动态模型参数。 @returns 返回固定成功结果的模型端口。 */
  createTextModel(options: AiTextModelOptions): TextModelPort {
    this.options.push(options)
    return new FixedTextModel(options)
  }
}

/** 不联网的固定文本模型。 */
class FixedTextModel implements TextModelPort {
  /** @param options 当前动态模型参数。 */
  constructor(private readonly options: AiTextModelOptions) {}

  /** @returns 当前模型的非敏感快照。 */
  getConfiguredModel() {
    return { provider: 'openai_compatible' as const, model: this.options.model, endpointOrigin: new URL(this.options.endpoint).origin }
  }

  /** @param request 当前模型请求。 @returns JSON 请求返回原子结论，文本请求返回 OK。 */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    return {
      structuredOutput: request.responseFormat === 'text'
        ? 'OK'
        : { facts: [{ statement: '重视证据。', evidenceInputIds: ['10000000-0000-4000-8000-000000000001'], confidence: 0.9 }] },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }
  }
}

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-ai-configuration-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('AI 接口、模型部署与算法配置', () => {
  it('加密保存密钥、编辑时保留原密文并只在检测阶段解密', async () => {
    const { service, modelFactory } = createServices()
    const connection = await service.createConnection({
      name: '主接口', protocol: 'openai_compatible', endpoint: 'https://model.example/v1',
      apiKey: 'secret-api-key', isEnabled: true,
    })

    const raw = database.getClient().prepare(`
      SELECT api_key_ciphertext FROM ai_connections WHERE id = ?
    `).get(connection.id) as { api_key_ciphertext: string }
    expect(raw.api_key_ciphertext).not.toContain('secret-api-key')
    expect(await service.listConnections()).toEqual([expect.objectContaining({ hasApiKey: true })])
    expect(JSON.stringify(await service.listConnections())).not.toContain('apiKeyCiphertext')

    await service.updateConnection(connection.id, {
      name: '主接口（编辑）', protocol: 'openai_compatible', endpoint: 'https://model.example/v1', isEnabled: true,
    })
    expect((database.getClient().prepare(`SELECT api_key_ciphertext FROM ai_connections WHERE id = ?`).get(connection.id) as { api_key_ciphertext: string }).api_key_ciphertext)
      .toBe(raw.api_key_ciphertext)

    const deployment = await service.createModelDeployment({
      connectionId: connection.id, name: '主文本模型', model: 'text-model', modality: 'text', isEnabled: true,
    })
    await expect(service.checkModelDeployment(deployment.id)).resolves.toEqual({
      healthy: true, message: '接口、凭据和文本模型均可用',
    })
    expect(modelFactory.options).toEqual([expect.objectContaining({ apiKey: 'secret-api-key', model: 'text-model' })])
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
    })
    expect(database.getClient().prepare(`
      SELECT action FROM audit_events WHERE target_id = 'persona_growth' ORDER BY created_at DESC LIMIT 1
    `).get()).toEqual({ action: 'ai_algorithm_configuration_published' })
  })
})

/**
 * 使用真实数据库、提示词与加密器创建配置管理和算法执行服务。
 * @returns 两个应用服务及可观察模型工厂。
 */
function createServices(): {
  service: AiConfigurationApplicationService
  algorithms: AiAlgorithmApplicationService
  modelFactory: RecordingModelFactory
} {
  const repository = new SqliteAiConfigurationRepository(database.getClient())
  const secretCipher = new AesGcmSecretCipher('x'.repeat(32))
  const modelFactory = new RecordingModelFactory()
  const identifiers = { create: () => randomUUID() }
  const clock = { now: () => 9_000 }
  const prompts = createTestAiPromptService(database, identifiers, clock)
  return {
    service: new AiConfigurationApplicationService({ repository, secretCipher, modelFactory, prompts, identifiers, clock }),
    algorithms: new AiAlgorithmApplicationService({ repository, secretCipher, modelFactory, prompts }),
    modelFactory,
  }
}
