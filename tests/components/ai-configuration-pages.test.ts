import { readBody } from 'h3'
import { useToast } from '#imports'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { PublishAiAlgorithmConfigurationInput, UpdateAiConnectionInput } from '../../shared/schemas/aiConfiguration'
import type { GrowthExtractAlgorithmTestInput, GrowthSynthesizeAlgorithmTestInput } from '../../shared/schemas/aiAlgorithmTest'
import type { SystemAiSettingsValues } from '../../shared/schemas/systemAi'
import type { AiAlgorithmTestResult } from '../../shared/types/aiAlgorithmTest'
import type { AiAlgorithmView, AiConnectionView, AiModelDeploymentView } from '../../shared/types/aiConfiguration'
import type { AiPromptWorkspaceView } from '../../shared/types/aiPrompt'
import AiAlgorithmsPage from '../../app/pages/ai-algorithms.vue'
import AiModelsPage from '../../app/pages/ai-models.vue'

/** 页面测试使用的脱敏接口连接。 */
const connection: AiConnectionView = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '主接口', protocol: 'openai_compatible', endpoint: 'https://model.example/v1',
  userAgent: 'RenYang-UI/1.0',
  hasApiKey: true, isEnabled: true, createdAt: 1_000, updatedAt: 1_000,
}

/** 页面测试使用的文本模型部署。 */
const deployment: AiModelDeploymentView = {
  id: '10000000-0000-4000-8000-000000000002', connectionId: connection.id,
  name: '成长模型', model: 'growth-model', modality: 'text', isEnabled: true,
  createdAt: 1_000, updatedAt: 1_000,
}

/** 页面测试使用的图片模型部署。 */
const imageDeployment: AiModelDeploymentView = {
  id: '10000000-0000-4000-8000-000000000003', connectionId: connection.id,
  name: '图片模型', model: 'image-model', modality: 'image', isEnabled: true,
  createdAt: 1_000, updatedAt: 1_000,
}

/** AI 模型页读取的完整系统 AI 设置。 */
const systemAiSettings: SystemAiSettingsValues = {
  textModelDeploymentId: '',
  imageModelDeploymentId: '',
  interestAnalysis: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000, maxEvidenceChunks: 8 },
  contentAnalysis: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
  draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
  feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
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

/** 页面测试使用的已配置人物记忆专用算法。 */
const memoryAlgorithm: AiAlgorithmView = {
  code: 'persona_memory', name: '人物记忆提炼', description: '两阶段证据门槛算法。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'extract', name: '证据提取', description: '提取带来源信号的候选。', promptCode: 'analysis.persona_memory_extract', ordinal: 0 },
    { key: 'synthesize', name: '记忆编译', description: '编译完整记忆草稿。', promptCode: 'analysis.persona_memory_synthesize', ordinal: 1 },
  ],
  steps: [
    { key: 'extract', name: '证据提取', description: '提取带来源信号的候选。', promptCode: 'analysis.persona_memory_extract', ordinal: 0, modelDeploymentId: deployment.id, parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 } },
    { key: 'synthesize', name: '记忆编译', description: '编译完整记忆草稿。', promptCode: 'analysis.persona_memory_synthesize', ordinal: 1, modelDeploymentId: deployment.id, parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 } },
  ],
}

/** 页面测试使用的两个成长算法步骤提示词。 */
const algorithmPrompts: AiPromptWorkspaceView[] = algorithm.stepDefinitions.map((step, index) => ({
  code: step.promptCode,
  name: step.name,
  category: '算法步骤',
  description: step.description,
  kind: 'text',
  variables: [],
  activeVersion: {
    id: `10000000-0000-4000-8000-00000000001${index}`,
    promptCode: step.promptCode,
    versionNo: 1,
    systemPromptTemplate: `${step.name}系统规则`,
    userPromptTemplate: `${step.name}用户模板`,
    changeSummary: '初始版本',
    publishedAt: 1_000,
  },
  draft: null,
  versions: [],
  updatedAt: 1_000,
}))

/** 页面测试使用的人物记忆算法步骤提示词。 */
const memoryAlgorithmPrompts: AiPromptWorkspaceView[] = memoryAlgorithm.stepDefinitions.map((step, index) => ({
  code: step.promptCode,
  name: step.name,
  category: '算法步骤',
  description: step.description,
  kind: 'text',
  variables: [],
  activeVersion: {
    id: `20000000-0000-4000-8000-00000000001${index}`,
    promptCode: step.promptCode,
    versionNo: 1,
    systemPromptTemplate: `${step.name}系统规则`,
    userPromptTemplate: `${step.name}用户模板`,
    changeSummary: '初始版本',
    publishedAt: 1_000,
  },
  draft: null,
  versions: [],
  updatedAt: 1_000,
}))

/** 编辑接口最后提交的正文。 */
let savedConnection: UpdateAiConnectionInput | null = null
/** 发布算法配置最后提交的正文。 */
let savedAlgorithm: PublishAiAlgorithmConfigurationInput | null = null
/** 默认模型表单最后提交的完整系统 AI 设置。 */
let savedSystemAiSettings: SystemAiSettingsValues | null = null
/** 算法测试按交互顺序提交的分步输入。 */
const algorithmTestInputs: Array<GrowthExtractAlgorithmTestInput | GrowthSynthesizeAlgorithmTestInput> = []

/** 页面测试使用的两步骤成功诊断。 */
const algorithmTestResult: AiAlgorithmTestResult = {
  algorithmCode: 'persona_growth', configurationVersion: 1, succeeded: true,
  steps: algorithm.steps.map((step, index) => ({
    stepKey: step.key,
    stepName: step.name,
    promptCode: step.promptCode,
    promptSource: index === 0 ? 'draft' : 'published',
    promptVersion: index === 0 ? null : 1,
    modelDeploymentId: deployment.id,
    model: deployment.model,
    endpointOrigin: 'https://model.example',
    parameters: step.parameters,
    variables: index === 0 ? { baselineJson: '[]', inputsJson: '[]' } : { baselineJson: '[]', factsJson: '[]' },
    systemPrompt: `${step.name}实际系统提示词`,
    userPrompt: `${step.name}实际用户提示词`,
    rawOutput: index === 0 ? '{"facts":[]}' : '完整成长提示词',
    parsedOutput: index === 0 ? { facts: [] } : { promptText: '完整成长提示词' },
    nextStepInput: index === 0 ? { baselineJson: '[]', factsJson: '[]' } : null,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    durationMs: 20,
    status: 'succeeded',
    error: null,
  })),
}

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
registerEndpoint('/api/v1/ai/model-deployments', () => ({ data: [deployment, imageDeployment] }))
registerEndpoint('/api/v1/system/ai-settings', () => ({ data: { values: systemAiSettings, updatedAt: null } }))
registerEndpoint('/api/v1/system/ai-settings', {
  method: 'PUT',
  /**
   * 记录默认模型选项卡提交的完整设置。
   * @param event Nuxt 测试服务器收到的设置保存请求。
   * @returns 模拟数据库保存后的设置视图。
   */
  handler: async (event) => {
    savedSystemAiSettings = await readBody<SystemAiSettingsValues>(event)
    return { data: { values: savedSystemAiSettings, updatedAt: 2_000 } }
  },
})
registerEndpoint('/api/v1/ai/algorithms', () => ({ data: [algorithm, memoryAlgorithm] }))
registerEndpoint('/api/v1/ai-prompts', () => ({ data: [...algorithmPrompts, ...memoryAlgorithmPrompts] }))
registerEndpoint(`/api/v1/ai/algorithms/${algorithm.code}`, {
  method: 'PUT',
  /** @param event 测试请求事件。 @returns 模拟发布后的算法。 */
  handler: async (event) => {
    savedAlgorithm = await readBody<PublishAiAlgorithmConfigurationInput>(event)
    return { data: algorithm }
  },
})
registerEndpoint(`/api/v1/ai/algorithms/${algorithm.code}/test`, {
  method: 'POST',
  /** @param event 测试请求事件。 @returns 模拟当前指定步骤的真实诊断。 */
  handler: async (event) => {
    const input = await readBody<GrowthExtractAlgorithmTestInput | GrowthSynthesizeAlgorithmTestInput>(event)
    algorithmTestInputs.push(input)
    await new Promise(resolve => setTimeout(resolve, 20))
    const step = input.stepKey === 'extract' ? algorithmTestResult.steps[0]! : algorithmTestResult.steps[1]!
    return { data: { ...algorithmTestResult, steps: [step] } }
  },
})

beforeEach(() => {
  savedConnection = null
  savedAlgorithm = null
  savedSystemAiSettings = null
  algorithmTestInputs.splice(0)
})

describe('AI 模型与算法配置页面', () => {
  it('只显示密钥已配置，编辑接口时不会把现有密钥回填或重新提交', async () => {
    const wrapper = await mountSuspended(AiModelsPage, { route: '/ai-models' })
    await flushPromises()

    expect(wrapper.text()).toContain('密钥已配置')
    expect(wrapper.text()).toContain('RenYang-UI/1.0')
    expect(wrapper.text()).not.toContain('secret-api-key')
    expect(wrapper.find('#ai-deployment-list-heading').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('input[type="password"]').element.value).toBe('')
    await wrapper.get('form[data-ai-connection-form]').trigger('submit')
    await flushPromises()

    expect(savedConnection).toEqual({
      name: connection.name,
      protocol: connection.protocol,
      endpoint: connection.endpoint,
      userAgent: connection.userAgent,
      isEnabled: true,
    })

    await wrapper.findAll('button').find(button => button.text().includes('模型部署'))!.trigger('click')
    expect(wrapper.find('#ai-deployment-list-heading').exists()).toBe(true)
    expect(wrapper.text()).toContain('按接口筛选')
  })

  it('在 AI 模型页直接选择并保存平台默认文本与图片模型', async () => {
    const wrapper = await mountSuspended(AiModelsPage, { route: '/ai-models' })
    await flushPromises()
    wrapper.vm.$nuxt.runWithContext(() => useToast().clear())

    await wrapper.findAll('button').find(button => button.text().includes('默认模型'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('默认文本与图片模型')
    const modelSelectors = wrapper.findAllComponents({ name: 'USelect' })
    expect(modelSelectors).toHaveLength(2)
    await modelSelectors[0]!.setValue(deployment.id)
    await modelSelectors[1]!.setValue(imageDeployment.id)
    await wrapper.get('form[data-system-ai-settings-form]').trigger('submit')
    await flushPromises()

    expect(savedSystemAiSettings).toEqual({
      ...systemAiSettings,
      textModelDeploymentId: deployment.id,
      imageModelDeploymentId: imageDeployment.id,
    })
    await vi.waitFor(() => expect(wrapper.vm.$nuxt.runWithContext(() => useToast().toasts.value)
      .some(notification => notification.description === '默认文本与图片模型已保存。')).toBe(true))
    expect(wrapper.text()).not.toContain('操作完成')
  })

  it('展示固定步骤和提示词绑定，并提交全部模型与参数作为新版本', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()

    expect(wrapper.text()).toContain('原子提取')
    expect(wrapper.text()).toContain('综合编译')
    expect(wrapper.text()).toContain('analysis.persona_growth_extract')
    expect(wrapper.text()).toContain('同页校准提示词')
    expect(wrapper.get('[data-ai-prompt-editor]').attributes('data-prompt-code')).toBe('analysis.persona_growth_extract')
    await wrapper.findAll('button').filter(button => button.text() === '编辑该步骤提示词')[1]!.trigger('click')
    expect(wrapper.get('[data-ai-prompt-editor]').attributes('data-prompt-code')).toBe('analysis.persona_growth_synthesize')
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

  it('明确真实调用边界，并用业务化成长输入展示逐步诊断', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()

    const panel = wrapper.get('[data-ai-algorithm-test-panel]')
    expect(panel.text()).toContain('真实调用模型')
    expect(panel.text()).toContain('不写入业务数据')
    expect(panel.text()).toContain('当前成长提示词基线')
    expect(panel.text()).toContain('本次成长资料')
    const inputs = panel.findAll('textarea')
    expect(inputs.every(input => input.classes().includes('w-full'))).toBe(true)
    await inputs[0]!.setValue('当前基线')
    await inputs[1]!.setValue('新增资料')
    await panel.find('form').trigger('submit')
    expect(panel.text()).toContain('正在测试第 1 步：原子提取')
    await flushPromises()

    expect(algorithmTestInputs).toEqual([{ stepKey: 'extract', baselineText: '当前基线', materialText: '新增资料' }])
    await vi.waitFor(() => expect(panel.text()).toContain('第一步通过，请继续第二步'))
    expect(panel.text()).not.toContain('综合编译实际系统提示词')
    expect(panel.findAll('button').some(button => button.text().includes('测试第 2 步'))).toBe(true)
    await panel.find('form').trigger('submit')
    expect(panel.text()).toContain('正在测试第 2 步：综合编译')
    expect(panel.find('form').exists()).toBe(false)
    expect(panel.text()).not.toContain('逐步结果')
    await vi.waitFor(() => expect(algorithmTestInputs).toHaveLength(2))
    expect(algorithmTestInputs[1]).toEqual({
      stepKey: 'synthesize', configurationVersion: 1, baselineJson: '[]', factsJson: '[]',
    })
    await vi.waitFor(() => expect(panel.text()).toContain('全部步骤通过'))
    expect(panel.text()).toContain('原子提取')
    expect(panel.text()).toContain('综合编译')
    expect(panel.text()).toContain('已保存草稿')
    expect(panel.text()).toContain('模型原始响应')
    expect(panel.text()).toContain('传给下一步的数据')
  })

  it('把人物记忆作为独立分类，并展示专用基线、素材和分步测试入口', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()

    expect(wrapper.text()).toContain('记忆提炼')
    const categoryButton = wrapper.findAll('button').find(button => button.text().includes('按来源与独立证据门槛'))!
    await categoryButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('analysis.persona_memory_extract')
    expect(wrapper.text()).toContain('证据提取')
    expect(wrapper.text()).toContain('记忆编译')
    const panel = wrapper.get('[data-ai-algorithm-test-panel]')
    expect(panel.text()).toContain('当前记忆提示词基线')
    expect(panel.text()).toContain('本次记忆素材')
    expect(panel.findAll('textarea')[1]!.attributes('placeholder')).toContain('---')
  })
})
