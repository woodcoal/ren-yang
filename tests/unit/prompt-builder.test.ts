import { describe, expect, it } from 'vitest'
import { buildSoulPromptAnalysisVariables, soulAnalysisPromptCode } from '../../server/application/content/SoulPromptBuilder'
import {
  buildDocumentPlanPromptVariables,
  buildInterestBatchPromptVariables,
  buildWorldDraftPromptVariables,
  GENERATION_PROMPT_CODES,
} from '../../server/application/generation/PromptBuilder'

/** 变量构建测试使用的最小固定运行上下文。 */
const PROMPT_CONTEXT = {
  persona: { promptText: '测试人物' },
  world: null,
  worldGrowthPrompt: '遵循世界成长经验。',
  personaGrowthPrompt: '回答先给结论。',
  personaMemoryPrompt: '曾经成功处理事实型文章。',
  scene: null,
  evidence: [],
}

describe('提示词变量契约', () => {
  it('兴趣判断只输出目录定义需要的固定 JSON 变量', () => {
    const variables = buildInterestBatchPromptVariables({
      ...PROMPT_CONTEXT,
      scene: '只判断长期兴趣，不考虑短期热点。',
    }, [{ itemId: 'item-2', text: '测试内容' }])

    expect(GENERATION_PROMPT_CODES.interestAssessment).toBe('generation.interest_assessment')
    expect(variables).toMatchObject({
      personaPromptJson: '"测试人物"',
      worldPromptJson: 'null',
      worldGrowthPromptJson: '"遵循世界成长经验。"',
      personaGrowthPromptJson: '"回答先给结论。"',
      personaMemoryPromptJson: '"曾经成功处理事实型文章。"',
      sceneJson: '"只判断长期兴趣，不考虑短期热点。"',
      contentJson: '[{"itemId":"item-2","text":"测试内容"}]',
    })
  })

  it('文档规划把块数和图片开关转换为稳定字符串变量', () => {
    const variables = buildDocumentPlanPromptVariables(PROMPT_CONTEXT, '生成图文', '包含标题与插图', 1, 4, true)

    expect(variables).toMatchObject({
      requirementJson: '"生成图文"',
      guidanceJson: '"包含标题与插图"',
      minimumBlocks: '1',
      maximumBlocks: '4',
      allowImages: 'true',
    })
  })

  it('世界快速初始化只提供经过 JSON 隔离的用户描述', () => {
    expect(buildWorldDraftPromptVariables('浮岛与风帆船构成的世界')).toEqual({
      promptJson: '"浮岛与风帆船构成的世界"',
    })
  })

  it('灵魂整理按对象类型选择稳定编码并隔离原文', () => {
    expect(soulAnalysisPromptCode('persona')).toBe('content.persona_soul_analysis')
    expect(soulAnalysisPromptCode('world')).toBe('content.world_soul_analysis')
    expect(buildSoulPromptAnalysisVariables('谨慎的档案管理员。')).toEqual({
      promptTextJson: '"谨慎的档案管理员。"',
    })
  })
})
