import { readBody } from 'h3'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { PublishAiAlgorithmConfigurationInput, UpdateAiConnectionInput } from '../../shared/schemas/aiConfiguration'
import type { AiAlgorithmView, AiConnectionView, AiModelDeploymentView } from '../../shared/types/aiConfiguration'
import AiAlgorithmsPage from '../../app/pages/ai-algorithms.vue'
import AiModelsPage from '../../app/pages/ai-models.vue'

/** 页面测试使用的脱敏接口连接。 */
const connection: AiConnectionView = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '主接口', protocol: 'openai_compatible', endpoint: 'https://model.example/v1',
  hasApiKey: true, isEnabled: true, createdAt: 1_000, updatedAt: 1_000,
}

/** 页面测试使用的文本模型部署。 */
const deployment: AiModelDeploymentView = {
  id: '10000000-0000-4000-8000-000000000002', connectionId: connection.id,
  name: '成长模型', model: 'growth-model', modality: 'text', isEnabled: true,
  createdAt: 1_000, updatedAt: 1_000,
}

/** 页面测试使用的已配置成长算法。 */
const algorithm: AiAlgorithmView = {
  code: 'persona_growth', name: '人物成长提炼', description: '两阶段成长算法。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'extract', name: '原子提取', description: '提取结论。', promptCode: 'analysis.persona_growth_extract', ordinal: 0 },
    { key: 'synthesize', name: '综合编译', description: '编译草稿。', promptCode: 'analysis.persona_growth_synthesize', ordinal: 1 },
  ],
  steps: [
    { key: 'extract', name: '原子提取', description: '提取结论。', promptCode: 'analysis.persona_growth_extract', ordinal: 0, modelDeploymentId: deployment.id, parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 } },
    { key: 'synthesize', name: '综合编译', description: '编译草稿。', promptCode: 'analysis.persona_growth_synthesize', ordinal: 1, modelDeploymentId: deployment.id, parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 } },
  ],
}

/** 编辑接口最后提交的正文。 */
let savedConnection: UpdateAiConnectionInput | null = null
/** 发布算法配置最后提交的正文。 */
let savedAlgorithm: PublishAiAlgorithmConfigurationInput | null = null

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/ai/connections', () => ({ data: [connection] }))
registerEndpoint(`/api/v1/ai/connections/${connection.id}`, {
  method: 'PUT',
  /** @param event 测试请求事件。 @returns 模拟保存后的脱敏连接。 */
  handler: async (event) => {
    savedConnection = await readBody<UpdateAiConnectionInput>(event)
    return { data: connection }
  },
})
registerEndpoint('/api/v1/ai/model-deployments', () => ({ data: [deployment] }))
registerEndpoint('/api/v1/ai/algorithms', () => ({ data: [algorithm] }))
registerEndpoint(`/api/v1/ai/algorithms/${algorithm.code}`, {
  method: 'PUT',
  /** @param event 测试请求事件。 @returns 模拟发布后的算法。 */
  handler: async (event) => {
    savedAlgorithm = await readBody<PublishAiAlgorithmConfigurationInput>(event)
    return { data: algorithm }
  },
})

beforeEach(() => {
  savedConnection = null
  savedAlgorithm = null
})

describe('AI 模型与算法配置页面', () => {
  it('只显示密钥已配置，编辑接口时不会把现有密钥回填或重新提交', async () => {
    const wrapper = await mountSuspended(AiModelsPage, { route: '/ai-models' })
    await flushPromises()

    expect(wrapper.text()).toContain('密钥已配置')
    expect(wrapper.text()).not.toContain('secret-api-key')
    await wrapper.findAll('button').find(button => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('input[type="password"]').element.value).toBe('')
    await wrapper.get('form[data-ai-connection-form]').trigger('submit')
    await flushPromises()

    expect(savedConnection).toEqual({
      name: connection.name,
      protocol: connection.protocol,
      endpoint: connection.endpoint,
      isEnabled: true,
    })
  })

  it('展示固定步骤和提示词绑定，并提交全部模型与参数作为新版本', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()

    expect(wrapper.text()).toContain('原子提取')
    expect(wrapper.text()).toContain('综合编译')
    expect(wrapper.text()).toContain('analysis.persona_growth_extract')
    await wrapper.get('form[data-ai-algorithm-form]').trigger('submit')
    await flushPromises()

    expect(savedAlgorithm).toEqual({
      steps: algorithm.steps.map(step => ({
        stepKey: step.key,
        modelDeploymentId: step.modelDeploymentId,
        parameters: step.parameters,
      })),
    })
  })
})
