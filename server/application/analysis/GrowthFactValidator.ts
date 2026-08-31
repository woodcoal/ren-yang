import { ApplicationError } from '../errors/ApplicationError'

/** 已完成证据校验、去重和计数的成长原子结论。 */
export interface ValidatedGrowthFact {
  /** 可直接进入成长综合步骤的原子陈述。 */
  statement: string
  /** 去重后的证据输入 UUID。 */
  evidenceInputIds: string[]
  /** 实际唯一证据数量。 */
  evidenceCount: number
  /** 相同陈述合并后的最高置信度。 */
  confidence: number
}

/**
 * 校验证据引用、合并完全相同的结论并计算实际证据数量。
 * @param facts 模型返回且已通过结构 Schema 的原子结论。
 * @param inputs 当前运行允许引用的不可变输入。
 * @returns 稳定排序、证据去重后的原子结论。
 */
export function validateAndMergeGrowthFacts(
  facts: Array<{ statement: string, evidenceInputIds: string[], confidence: number }>,
  inputs: Array<{ id: string }>,
): ValidatedGrowthFact[] {
  const validEvidenceIds = new Set(inputs.map(input => input.id))
  const merged = new Map<string, { statement: string, evidenceInputIds: Set<string>, confidence: number }>()
  for (const fact of facts) {
    if (fact.evidenceInputIds.some(id => !validEvidenceIds.has(id))) {
      throw new ApplicationError('MODEL_OUTPUT_INVALID', '模型返回的成长结论引用了不存在的资料', 502)
    }
    const key = fact.statement.replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
    const current = merged.get(key)
    if (current) {
      fact.evidenceInputIds.forEach(id => current.evidenceInputIds.add(id))
      current.confidence = Math.max(current.confidence, fact.confidence)
    }
    else {
      merged.set(key, {
        statement: fact.statement,
        evidenceInputIds: new Set(fact.evidenceInputIds),
        confidence: fact.confidence,
      })
    }
  }
  return [...merged.values()].map(fact => ({
    statement: fact.statement,
    evidenceInputIds: [...fact.evidenceInputIds].sort(),
    evidenceCount: fact.evidenceInputIds.size,
    confidence: fact.confidence,
  }))
}
