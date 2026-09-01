import { readBody } from 'h3'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { PublishAiAlgorithmConfigurationInput, SaveAiModelDeploymentInput, UpdateAiConnectionInput } from '../../shared/schemas/aiConfiguration'
import type { GrowthExtractAlgorithmTestInput, GrowthSynthesizeAlgorithmTestInput } from '../../shared/schemas/aiAlgorithmTest'
import type { AiAlgorithmTestResult } from '../../shared/types/aiAlgorithmTest'
import type { AiAlgorithmView, AiConnectionView, AiModelDeploymentView } from '../../shared/types/aiConfiguration'
import type { AiPromptWorkspaceView } from '../../shared/types/aiPrompt'
import type { SystemAiSettingsValues } from '../../shared/schemas/systemAi'
import AiAlgorithmsPage from '../../app/pages/ai-algorithms.vue'
import AiModelsPage from '../../app/pages/ai-models.vue'
import AiModelDeploymentEditor from '../../app/components/aiConfiguration/AiModelDeploymentEditor.vue'

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
  name: '成长模型', model: 'growth-model', modality: 'text', thinkingControl: 'reasoning_effort', isEnabled: true,
  createdAt: 1_000, updatedAt: 1_000,
}

/** 页面测试使用的图片模型部署。 */
const imageDeployment: AiModelDeploymentView = {
  id: '10000000-0000-4000-8000-000000000003', connectionId: connection.id,
  name: '图片模型', model: 'image-model', modality: 'image', thinkingControl: 'none', isEnabled: true,
  createdAt: 1_000, updatedAt: 1_000,
}

/** 页面测试使用的已配置成长算法。 */
const algorithm: AiAlgorithmView = {
  code: 'persona_growth', name: '人物成长提炼', description: '两阶段成长算法。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'extract', name: '原子提取', description: '提取结论。', promptCode: 'analysis.persona_growth_extract', modality: 'text', ordinal: 0 },
    { key: 'synthesize', name: '综合编译', description: '编译草稿。', promptCode: 'analysis.persona_growth_synthesize', modality: 'text', ordinal: 1 },
  ],
  steps: [
    { key: 'extract', name: '原子提取', description: '提取结论。', promptCode: 'analysis.persona_growth_extract', modality: 'text', ordinal: 0, modelDeploymentId: deployment.id, parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 } },
    { key: 'synthesize', name: '综合编译', description: '编译草稿。', promptCode: 'analysis.persona_growth_synthesize', modality: 'text', ordinal: 1, modelDeploymentId: deployment.id, parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 } },
  ],
}

/** 页面测试使用的已配置人物记忆专用算法。 */
const memoryAlgorithm: AiAlgorithmView = {
  code: 'persona_memory', name: '人物记忆提炼', description: '两阶段证据门槛算法。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'extract', name: '证据提取', description: '提取带来源信号的候选。', promptCode: 'analysis.persona_memory_extract', modality: 'text', ordinal: 0 },
    { key: 'synthesize', name: '记忆编译', description: '编译完整记忆草稿。', promptCode: 'analysis.persona_memory_synthesize', modality: 'text', ordinal: 1 },
  ],
  steps: [
    { key: 'extract', name: '证据提取', description: '提取带来源信号的候选。', promptCode: 'analysis.persona_memory_extract', modality: 'text', ordinal: 0, modelDeploymentId: deployment.id, parameters: { temperature: 0, maxOutputTokens: 2_048, timeoutMs: 30_000 } },
    { key: 'synthesize', name: '记忆编译', description: '编译完整记忆草稿。', promptCode: 'analysis.persona_memory_synthesize', modality: 'text', ordinal: 1, modelDeploymentId: deployment.id, parameters: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 } },
  ],
}

/** AI 算法页使用的文章生成单步骤算法。 */
const articleAlgorithm: AiAlgorithmView = {
  code: 'article_generation', name: '文章生成', description: '一次生成完整文章。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'generate', name: '生成文章', description: '生成完整文章。', promptCode: 'generation.article', modality: 'text', ordinal: 0 },
  ],
  steps: [
    {
      key: 'generate', name: '生成文章', description: '生成完整文章。', promptCode: 'generation.article', modality: 'text', ordinal: 0,
      modelDeploymentId: deployment.id, parameters: { temperature: 0.6, maxOutputTokens: 4_096, timeoutMs: 60_000 },
    },
  ],
}

/** AI 算法页使用的文章配图分析单步骤算法。 */
const articleImageAlgorithm: AiAlgorithmView = {
  code: 'article_image_analysis', name: '文章配图分析', description: '分析配图位置。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'analyze', name: '分析配图', description: '分析配图位置。', promptCode: 'generation.article_images', modality: 'text', ordinal: 0 },
  ],
  steps: [
    {
      key: 'analyze', name: '分析配图', description: '分析配图位置。', promptCode: 'generation.article_images', modality: 'text', ordinal: 0,
      modelDeploymentId: deployment.id, parameters: { temperature: 0.2, maxOutputTokens: 2_048, timeoutMs: 30_000 },
    },
  ],
}

/** AI 算法页使用的文章图片生成单步骤算法。 */
const articleImageGenerationAlgorithm: AiAlgorithmView = {
  code: 'article_image_generation', name: '文章图片生成', description: '生成文章配图。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'generate', name: '生成图片', description: '生成一张文章图片。', promptCode: 'generation.image_block', modality: 'image', ordinal: 0 },
  ],
  steps: [
    {
      key: 'generate', name: '生成图片', description: '生成一张文章图片。', promptCode: 'generation.image_block', modality: 'image', ordinal: 0,
      modelDeploymentId: imageDeployment.id,
      parameters: { temperature: 0, maxOutputTokens: 64, timeoutMs: 60_000, maxImageWidth: 2_048, maxImageHeight: 2_048 },
    },
  ],
}

/** AI 算法页使用的批量兴趣判定算法。 */
const interestAlgorithm: AiAlgorithmView = {
  code: 'interest_assessment', name: '兴趣判定', description: '同一人物批量判定多条文本。', implementationVersion: 1,
  activeConfigurationVersion: 1, configurationVersionCount: 1, updatedAt: 1_000,
  stepDefinitions: [
    { key: 'assess', name: '批量判定', description: '逐项输出三态兴趣结论。', promptCode: 'generation.interest_assessment', modality: 'text', ordinal: 0 },
  ],
  steps: [{
    key: 'assess', name: '批量判定', description: '逐项输出三态兴趣结论。', promptCode: 'generation.interest_assessment', modality: 'text', ordinal: 0,
    modelDeploymentId: deployment.id, parameters: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
  }],
}

/** AI 算法页使用的批量兴趣提示词。 */
const interestPrompt: AiPromptWorkspaceView = {
  code: 'generation.interest_assessment', name: '兴趣判定', category: '算法步骤', description: '批量兴趣判定。', kind: 'text', variables: [],
  activeVersion: {
    id: '30000000-0000-4000-8000-000000000001', promptCode: 'generation.interest_assessment', versionNo: 2,
    systemPromptTemplate: '批量兴趣规则', userPromptTemplate: '<待判断文本列表>{{contentJson}}</待判断文本列表>',
    changeSummary: '批量契约', publishedAt: 1_000,
  },
  draft: null, versions: [], updatedAt: 1_000,
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
/** 模型部署页最后提交的正文。 */
let savedDeployment: SaveAiModelDeploymentInput | null = null
/** 默认模型页最后提交的模型部署选择。 */
let savedDefaultModels: SystemAiSettingsValues | null = null
/** 发布算法配置最后提交的正文。 */
let savedAlgorithm: PublishAiAlgorithmConfigurationInput | null = null
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
registerEndpoint('/api/v1/ai/model-deployments', {
  method: 'POST',
  /** @param event 测试请求事件。 @returns 模拟保存后的模型部署。 */
  handler: async (event) => {
    savedDeployment = await readBody<SaveAiModelDeploymentInput>(event)
    return { data: deployment }
  },
})
registerEndpoint('/api/v1/system/ai-settings', () => ({
  data: { values: { textModelDeploymentId: deployment.id, imageModelDeploymentId: imageDeployment.id }, updatedAt: 1_000 },
}))
registerEndpoint('/api/v1/system/ai-settings', {
  method: 'PUT',
  /** @param event 测试请求事件。 @returns 模拟保存后的默认模型设置。 */
  handler: async (event) => {
    savedDefaultModels = await readBody<SystemAiSettingsValues>(event)
    return { data: { values: savedDefaultModels, updatedAt: 2_000 } }
  },
})
registerEndpoint('/api/v1/ai/algorithms', () => ({ data: [algorithm, memoryAlgorithm, interestAlgorithm, articleAlgorithm, articleImageAlgorithm, articleImageGenerationAlgorithm] }))
registerEndpoint('/api/v1/ai-prompts', () => ({ data: [...algorithmPrompts, ...memoryAlgorithmPrompts, interestPrompt] }))
registerEndpoint(`/api/v1/ai/algorithms/${algorithm.code}`, {
  method: 'PUT',
  /** @param event 测试请求事件。 @returns 模拟发布后的算法。 */
  handler: async (event) => {
    savedAlgorithm = await readBody<PublishAiAlgorithmConfigurationInput>(event)
    return { data: algorithm }
  },
})
registerEndpoint(`/api/v1/ai/algorithms/${articleImageGenerationAlgorithm.code}`, {
  method: 'PUT',
  /** @param event 测试请求事件。 @returns 模拟发布后的图片生成算法。 */
  handler: async (event) => {
    savedAlgorithm = await readBody<PublishAiAlgorithmConfigurationInput>(event)
    return { data: articleImageGenerationAlgorithm }
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
  savedDeployment = null
  savedDefaultModels = null
  savedAlgorithm = null
  algorithmTestInputs.splice(0)
})

describe('AI 模型与算法配置页面', () => {
  it('把默认文本和图片模型放在模型配置的最后一个选项卡', async () => {
    const wrapper = await mountSuspended(AiModelsPage, { route: '/ai-models' })
    await flushPromises()
    const tabs = wrapper.find('.model-setup-path').findAll('button')

    expect(tabs.map(tab => tab.find('strong').text())).toEqual(['接口连接', '模型部署', '默认模型'])
    await tabs[2]!.trigger('click')
    expect(wrapper.text()).toContain('默认文本模型')
    expect(wrapper.text()).toContain('默认图片模型')
    expect(wrapper.text()).toContain('成长模型 · growth-model')
    expect(wrapper.text()).toContain('图片模型 · image-model')

    wrapper.findComponent({ name: 'SystemAiDefaultModelsForm' }).vm.$emit('submit', {
      textModelDeploymentId: deployment.id,
      imageModelDeploymentId: imageDeployment.id,
    })
    await flushPromises()
    expect(savedDefaultModels).toEqual({
      textModelDeploymentId: deployment.id,
      imageModelDeploymentId: imageDeployment.id,
    })
  })

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

  it('模型配置页面不再混入算法配置分区，并仅在末尾选项卡恢复默认模型', async () => {
    const wrapper = await mountSuspended(AiModelsPage, { route: '/ai-models' })
    await flushPromises()

    expect(wrapper.text()).toContain('模型配置')
    expect(wrapper.find('a[href="/ai-algorithms"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('默认模型')
    expect(wrapper.find('form[data-system-ai-settings-form]').exists()).toBe(false)
  })

  it('文本模型部署选择关闭思考请求格式并完整提交', async () => {
    const wrapper = await mountSuspended(AiModelsPage, { route: '/ai-models' })
    await flushPromises()
    await wrapper.findAll('.model-setup-path button')[1]!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '新增模型')!.trigger('click')
    await flushPromises()

    const editor = wrapper.findComponent(AiModelDeploymentEditor)
    expect(editor.text()).toContain('关闭思考字段')
    expect(editor.text()).not.toContain('reasoning: { effort: none }')
    editor.vm.$emit('save', {
      connectionId: connection.id, name: '关闭思考模型', model: 'reasoning-model', modality: 'text',
      thinkingControl: 'reasoning_effort', isEnabled: true,
    })
    await flushPromises()

    expect(savedDeployment).toEqual({
      connectionId: connection.id, name: '关闭思考模型', model: 'reasoning-model', modality: 'text',
      thinkingControl: 'reasoning_effort', isEnabled: true,
    })
  })

  it('展示固定步骤和提示词绑定，并提交全部模型与参数作为新版本', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()

    expect(wrapper.text()).toContain('原子提取')
    expect(wrapper.text()).toContain('综合编译')
    expect(wrapper.text()).toContain('analysis.persona_growth_extract')
    expect(wrapper.text()).toContain('同页校准提示词')
    expect(wrapper.text().indexOf('同页校准提示词')).toBeLessThan(wrapper.text().indexOf('运行诊断'))
    expect(wrapper.get('[data-ai-prompt-editor]').attributes('data-prompt-code')).toBe('analysis.persona_growth_extract')
    await wrapper.findAll('button').filter(button => button.text() === '编辑该步骤提示词')[1]!.trigger('click')
    expect(wrapper.get('[data-ai-prompt-editor]').attributes('data-prompt-code')).toBe('analysis.persona_growth_synthesize')
    await wrapper.get('form[data-ai-algorithm-form]').trigger('submit')
    await flushPromises()

    expect(savedAlgorithm).toEqual({
      steps: algorithm.steps.map(step => ({
        stepKey: step.key,
        modelDeploymentId: step.modelDeploymentId,
        parameters: { ...step.parameters, disableThinking: false },
      })),
    })
  })

  it('文本步骤提交关闭思考与零输出 Token，图片步骤不显示该开关', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()
    const form = wrapper.get('form[data-ai-algorithm-form]')
    const inputs = form.findAll('input[type="number"]')
    await inputs[1]!.setValue(0)
    await form.findAll('[role="checkbox"]')[0]!.trigger('click')
    await form.trigger('submit')
    await flushPromises()

    expect(savedAlgorithm?.steps[0]).toEqual({
      stepKey: 'extract', modelDeploymentId: deployment.id,
      parameters: { temperature: 0, maxOutputTokens: 0, timeoutMs: 30_000, disableThinking: true },
    })
    expect(form.text()).toContain('关闭思考')
    expect(inputs[1]!.attributes('min')).toBe('0')
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

  it('把兴趣判定、文章生成与配图分析集中到兴趣与创作分类', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()

    const categoryButton = wrapper.findAll('button').find(button => button.text().includes('判断兴趣、生成或修正文章'))!
    await categoryButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('兴趣判定')
    expect(wrapper.text()).toContain('generation.interest_assessment')
    expect(wrapper.text()).toContain('文章生成')
    expect(wrapper.text()).toContain('文章配图分析')
    expect(wrapper.text()).toContain('当前算法使用业务闭环验证')
    expect(wrapper.find('[data-ai-algorithm-test-panel]').exists()).toBe(false)
    const articleButton = wrapper.findAll('button').find(button => button.text().includes('文章生成'))
    expect(articleButton).toBeDefined()
    await articleButton?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('generation.article')
    await wrapper.findAll('button').find(button => button.text().includes('文章配图分析'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('generation.article_images')
  })

  it('仅为图片生成步骤展示二次裁剪上限并随配置发布', async () => {
    const wrapper = await mountSuspended(AiAlgorithmsPage, { route: '/ai-algorithms' })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text().includes('判断兴趣、生成或修正文章'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('文章图片生成'))!.trigger('click')
    await flushPromises()

    const form = wrapper.get('form[data-ai-algorithm-form]')
    expect(form.text()).toContain('最大宽度（像素）')
    expect(form.text()).toContain('最大高度（像素）')
    expect(form.text()).not.toContain('关闭思考')
    const inputs = form.findAll('input[type="number"]')
    expect(inputs).toHaveLength(3)
    await inputs[0]!.setValue(1_280)
    await inputs[1]!.setValue(720)
    await form.trigger('submit')
    await flushPromises()

    expect(savedAlgorithm).toEqual({
      steps: [{
        stepKey: 'generate',
        modelDeploymentId: imageDeployment.id,
        parameters: { temperature: 0, maxOutputTokens: 64, timeoutMs: 60_000, maxImageWidth: 1_280, maxImageHeight: 720 },
      }],
    })
  })
})
