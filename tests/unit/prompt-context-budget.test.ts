import { describe, expect, it } from 'vitest'
import { textModelParametersSchema } from '../../shared/schemas/generation'
import { selectPromptContextByBudget, type PromptBudgetCandidate } from '../../server/domain/generation/PromptContextBudget'

/** @param overrides 需要覆盖的预算字段。 @returns 已通过共享规则校验的运行参数。 */
function parameters(overrides: Record<string, number> = {}) {
  return textModelParametersSchema.parse({
    temperature: 0.4,
    maxOutputTokens: 512,
    timeoutMs: 60_000,
    maxEvidenceChunks: 8,
    maxTextBlocks: 12,
    maxImageBlocks: 4,
    maxPromptCharacters: 120_000,
    maxTotalTokens: 50_000,
    maxBlockAttempts: 2,
    contextWindowTokens: 8_000,
    reservedOutputTokens: 1_000,
    safetyMarginTokens: 500,
    worldBudgetTokens: 1_000,
    worldSoulBudgetTokens: 400,
    worldGrowthBudgetTokens: 600,
    personaBudgetTokens: 2_000,
    personaSoulBudgetTokens: 800,
    personaGrowthBudgetTokens: 600,
    personaMemoryBudgetTokens: 600,
    sourceBudgetTokens: 1_000,
    ...overrides,
  })
}

/** @param category 上下文分类。 @param tokens 估算 Token。 @param index 稳定序号。 @returns 完整预算候选。 */
function candidate(category: PromptBudgetCandidate['category'], tokens: number, index: number): PromptBudgetCandidate {
  return {
    entityId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    category,
    role: category === 'source' ? 'reference' : category === 'persona_memory' ? 'memory' : 'growth',
    content: `候选 ${index}`,
    contentHash: String(index).padStart(64, '0'),
    estimatedTokens: tokens,
  }
}

describe('提示词分层 Token 预算', () => {
  it('父子预算均为硬上限且超限条目整条跳过', () => {
    const result = selectPromptContextByBudget({
      parameters: parameters({ sourceBudgetTokens: 100 }),
      fixedInputTokens: 1_000,
      worldSoulTokens: 200,
      personaSoulTokens: 300,
      candidates: [candidate('source', 60, 1), candidate('source', 60, 2)],
    })

    expect(result.selected.map(item => item.entityId)).toEqual(['00000000-0000-4000-8000-000000000001'])
    expect(result.skipped).toEqual([
      expect.objectContaining({ entityId: '00000000-0000-4000-8000-000000000002', skippedReason: 'category_budget' }),
    ])
    expect(result.used.sources).toBe(60)
  })

  it('总预算不足时优先保留世界成长和人物成长', () => {
    const result = selectPromptContextByBudget({
      parameters: parameters({ contextWindowTokens: 5_000, reservedOutputTokens: 512, safetyMarginTokens: 0 }),
      fixedInputTokens: 4_350,
      worldSoulTokens: 100,
      personaSoulTokens: 100,
      candidates: [
        candidate('source', 50, 1),
        candidate('persona_memory', 50, 2),
        candidate('persona_growth', 50, 3),
        candidate('world_growth', 50, 4),
      ],
    })

    expect(result.selected.map(item => item.category)).toEqual(['world_growth', 'persona_growth'])
    expect(result.skipped.map(item => item.category)).toEqual(['persona_memory', 'source'])
    expect(result.skipped.every(item => item.skippedReason === 'total_budget')).toBe(true)
  })

  it('不可省略人物灵魂超过子预算时明确失败', () => {
    expect(() => selectPromptContextByBudget({
      parameters: parameters(),
      fixedInputTokens: 1_000,
      worldSoulTokens: 0,
      personaSoulTokens: 801,
      candidates: [],
    })).toThrow('人物灵魂运行摘要超过人物灵魂预算')
  })
})
