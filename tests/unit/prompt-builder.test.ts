import { describe, expect, it } from 'vitest'
import { buildSoulPromptAnalysisPrompt } from '../../server/application/content/SoulPromptBuilder'
import { buildDocumentPlanPrompt, buildInterestPrompt, buildWorldDraftPrompt, GENERATION_PROMPT_VERSION } from '../../server/application/generation/PromptBuilder'

describe('真实模型提示契约', () => {
  it('明确声明兴趣因素的对象结构和数值边界', () => {
    // 真实模型不会读取 TypeScript Schema，因此提示必须完整表达容易被误解的嵌套结构。
    const prompt = buildInterestPrompt({
      persona: {
        summary: '测试人物',
        identityFacts: '',
        interests: '',
        valuesAndMotivations: '',
        expressionStyle: '',
        appearance: '',
        visualStyle: '',
        constraints: '',
      },
      world: null,
      worldGrowthPrompt: '遵循世界成长经验。',
      personaGrowthPrompt: '回答先给结论。',
      personaMemoryPrompt: '曾经成功处理事实型文章。',
      scene: null,
      evidence: [],
    }, '测试内容')

    expect(GENERATION_PROMPT_VERSION).toBe('artifact-v8')
    expect(prompt.systemPrompt).toContain('factors 必须是对象数组')
    expect(prompt.systemPrompt).toContain('dimension、score、explanation')
    expect(prompt.systemPrompt).toContain('score 必须是 -1 到 1 的数字')
    expect(prompt.userPrompt).toContain('<当前世界成长提示词>"遵循世界成长经验。"</当前世界成长提示词>')
    expect(prompt.userPrompt).toContain('<当前人物成长提示词>"回答先给结论。"</当前人物成长提示词>')
    expect(prompt.userPrompt).toContain('<当前人物记忆提示词>"曾经成功处理事实型文章。"</当前人物记忆提示词>')
  })

  it('明确声明文档格式是枚举字符串数组而不是说明对象', () => {
    const prompt = buildDocumentPlanPrompt({
      persona: {
        summary: '测试人物',
        identityFacts: '',
        interests: '',
        valuesAndMotivations: '',
        expressionStyle: '',
        appearance: '',
        visualStyle: '',
        constraints: '',
      },
      world: null,
      worldGrowthPrompt: null,
      personaGrowthPrompt: null,
      personaMemoryPrompt: null,
      scene: null,
      evidence: [],
    }, '生成图文', '包含标题与插图', 1, 4, true)

    expect(prompt.systemPrompt).toContain('requestedFormats 必须是只含 html、markdown、txt 枚举值的字符串数组')
    expect(prompt.systemPrompt).toContain('禁止输出格式说明对象')
    expect(prompt.systemPrompt).toContain('aspectRatio 只能是 1:1、4:3、3:4、16:9、9:16')
  })

  it('世界快速初始化只使用用户描述并要求完整结构', () => {
    const prompt = buildWorldDraftPrompt('浮岛与风帆船构成的世界')

    expect(prompt.userPrompt).toContain('浮岛与风帆船构成的世界')
    expect(prompt.systemPrompt).toContain('用户明确描述是唯一事实来源')
    expect(prompt.systemPrompt).toContain('name、summary 和 snapshot')
    expect(prompt.systemPrompt).toContain('promptText')
    expect(prompt.systemPrompt).toContain('禁止写入返回内容')
    expect(prompt.systemPrompt).not.toContain('当前结果只是待用户编辑确认的候选草稿')
  })

  it('灵魂自动分析只允许整理表达并要求单文本结果', () => {
    const prompt = buildSoulPromptAnalysisPrompt('persona', '谨慎的档案管理员。')

    expect(prompt.systemPrompt).toContain('不得新增、推测或补全任何设定')
    expect(prompt.systemPrompt).toContain('只能包含 promptText 字符串字段')
    expect(prompt.systemPrompt).toContain('禁止写入候选、确认、发布、AI 生成')
    expect(prompt.userPrompt).toContain('谨慎的档案管理员。')
  })
})
