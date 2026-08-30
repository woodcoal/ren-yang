import type { TextModelParameters } from '../../../shared/schemas/generation'
import type { PromptContextCategory, PromptContextItemSnapshot } from '../../../shared/types/generation'

/** 可参与运行提示词预算选择的完整候选。 */
export interface PromptBudgetCandidate {
  /** SQLite 业务实体 UUID。 */
  entityId: string
  /** 所属预算分类。 */
  category: PromptContextCategory
  /** 证据角色。 */
  role: PromptContextItemSnapshot['role']
  /** 固定正文。 */
  content: string
  /** 固定正文 SHA-256。 */
  contentHash: string
  /** 已包含提示序列化开销的估算 Token。 */
  estimatedTokens: number
}

/** 分层预算选择所需的固定输入。 */
export interface PromptBudgetSelectionInput {
  /** 运行参数快照。 */
  parameters: TextModelParameters
  /** 无可选成长、记忆和资料时，初始提示已经使用的 Token。 */
  fixedInputTokens: number
  /** 世界灵魂提示词 Token；没有世界灵魂时为零。 */
  worldSoulTokens: number
  /** 人物灵魂提示词 Token。 */
  personaSoulTokens: number
  /** 已经过 SQLite 范围和状态校验，且按相关性排列的候选。 */
  candidates: PromptBudgetCandidate[]
}

/** 分层预算选择结果。 */
export interface PromptBudgetSelectionResult {
  /** 模型可用输入 Token。 */
  availableInputTokens: number
  /** 选中候选。 */
  selected: PromptBudgetCandidate[]
  /** 因预算跳过的候选及原因。 */
  skipped: Array<PromptBudgetCandidate & { skippedReason: Exclude<PromptContextItemSnapshot['skippedReason'], null> }>
  /** 各分类最终估算量。 */
  used: Record<'world' | 'worldGrowth' | 'persona' | 'personaGrowth' | 'personaMemory' | 'sources', number>
}

/**
 * 按父子硬上限选择完整条目，任何条目都不会被截断。
 * @param input 固定提示、灵魂和已排序候选。
 * @returns 最终选中、跳过和分类用量。
 * @throws Error 固定提示或不可省略灵魂已经突破预算时抛出。
 */
export function selectPromptContextByBudget(input: PromptBudgetSelectionInput): PromptBudgetSelectionResult {
  const parameters = input.parameters
  const availableInputTokens = parameters.contextWindowTokens - parameters.reservedOutputTokens - parameters.safetyMarginTokens
  if (input.worldSoulTokens > parameters.worldSoulBudgetTokens) throw new Error('世界灵魂提示词超过世界灵魂预算')
  if (input.worldSoulTokens > parameters.worldBudgetTokens) throw new Error('世界灵魂提示词超过世界总预算')
  if (input.personaSoulTokens > parameters.personaSoulBudgetTokens) throw new Error('人物灵魂提示词超过人物灵魂预算')
  if (input.personaSoulTokens > parameters.personaBudgetTokens) throw new Error('人物灵魂提示词超过人物总预算')
  if (input.fixedInputTokens > availableInputTokens) throw new Error('系统规则、任务和不可省略灵魂已经超过可用输入预算')

  const used = {
    world: input.worldSoulTokens,
    worldGrowth: 0,
    persona: input.personaSoulTokens,
    personaGrowth: 0,
    personaMemory: 0,
    sources: 0,
  }
  let totalUsed = input.fixedInputTokens
  const selected: PromptBudgetCandidate[] = []
  const skipped: PromptBudgetSelectionResult['skipped'] = []
  for (const candidate of prioritizeCandidates(input.candidates)) {
    const limits = resolveCandidateLimits(candidate.category, parameters, used)
    if (limits.categoryUsed + candidate.estimatedTokens > limits.categoryLimit) {
      skipped.push({ ...candidate, skippedReason: 'category_budget' })
      continue
    }
    if (limits.parentUsed + candidate.estimatedTokens > limits.parentLimit) {
      skipped.push({ ...candidate, skippedReason: 'parent_budget' })
      continue
    }
    if (totalUsed + candidate.estimatedTokens > availableInputTokens) {
      skipped.push({ ...candidate, skippedReason: 'total_budget' })
      continue
    }
    selected.push(candidate)
    totalUsed += candidate.estimatedTokens
    addCandidateUsage(candidate.category, candidate.estimatedTokens, used)
  }
  return { availableInputTokens, selected, skipped, used }
}

/** @param candidates 由提供器排序的候选。 @returns 按不可缩减优先级分组且保持组内顺序的副本。 */
function prioritizeCandidates(candidates: PromptBudgetCandidate[]): PromptBudgetCandidate[] {
  const rank: Record<PromptContextCategory, number> = {
    world_growth: 0,
    persona_growth: 1,
    persona_memory: 2,
    source: 3,
  }
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => rank[left.candidate.category] - rank[right.candidate.category] || left.index - right.index)
    .map(item => item.candidate)
}

/**
 * 解析候选的分类及父级当前用量和上限。
 * @param category 候选分类。
 * @param parameters 预算配置。
 * @param used 当前分类用量。
 * @returns 分类及父级限制。
 */
function resolveCandidateLimits(
  category: PromptContextCategory,
  parameters: TextModelParameters,
  used: PromptBudgetSelectionResult['used'],
): { categoryUsed: number, categoryLimit: number, parentUsed: number, parentLimit: number } {
  if (category === 'world_growth') {
    return { categoryUsed: used.worldGrowth, categoryLimit: parameters.worldGrowthBudgetTokens, parentUsed: used.world, parentLimit: parameters.worldBudgetTokens }
  }
  if (category === 'persona_growth') {
    return { categoryUsed: used.personaGrowth, categoryLimit: parameters.personaGrowthBudgetTokens, parentUsed: used.persona, parentLimit: parameters.personaBudgetTokens }
  }
  if (category === 'persona_memory') {
    return { categoryUsed: used.personaMemory, categoryLimit: parameters.personaMemoryBudgetTokens, parentUsed: used.persona, parentLimit: parameters.personaBudgetTokens }
  }
  return { categoryUsed: used.sources, categoryLimit: parameters.sourceBudgetTokens, parentUsed: used.sources, parentLimit: parameters.sourceBudgetTokens }
}

/** @param category 候选分类。 @param tokens 新增 Token。 @param used 可变用量。 @returns 更新结束时无返回值。 */
function addCandidateUsage(category: PromptContextCategory, tokens: number, used: PromptBudgetSelectionResult['used']): void {
  if (category === 'world_growth') {
    used.worldGrowth += tokens
    used.world += tokens
  }
  else if (category === 'persona_growth') {
    used.personaGrowth += tokens
    used.persona += tokens
  }
  else if (category === 'persona_memory') {
    used.personaMemory += tokens
    used.persona += tokens
  }
  else {
    used.sources += tokens
  }
}
