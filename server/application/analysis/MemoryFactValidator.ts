import { ApplicationError } from '../errors/ApplicationError'

/** 人物记忆证据由程序根据不可变输入类型派生的信号。 */
export type MemoryEvidenceSignal = 'external_record' | 'task_result'

/** 通过来源、独立性和形成门槛校验的记忆原子事实。 */
export interface ValidatedMemoryFact {
  /** 可进入记忆编译步骤的原子陈述。 */
  statement: string
  /** 记忆业务类型。 */
  memoryType: 'interest' | 'judgment' | 'experience' | 'preference'
  /** 去重后的有效证据及其信号类型。 */
  evidence: Array<{ inputId: string, signalType: MemoryEvidenceSignal }>
  /** 实际独立有效证据数量。 */
  independentEvidenceCount: number
  /** 相同陈述合并后的最高置信度。 */
  confidence: number
  /** 模型识别但未自动裁决的冲突说明。 */
  conflicts: string[]
}

/** 人物记忆算法待校验的原子候选。 */
export interface MemoryFactCandidate {
  /** 候选陈述。 */
  statement: string
  /** 候选记忆类型。 */
  memoryType: ValidatedMemoryFact['memoryType']
  /** 模型引用的证据；业务信号由程序根据输入类型派生。 */
  evidence: Array<{ inputId: string }>
  /** 模型置信度。 */
  confidence: number
  /** 模型发现的冲突。 */
  conflicts: string[]
}

/** 可供人物记忆候选引用的不可变批次输入。 */
export interface MemoryFactInput {
  /** 批次输入 UUID。 */
  id: string
  /** 历史任务或第三方经历。 */
  inputType: string
}

/**
 * 校验人物记忆证据来源，排除自我输出并执行独立证据形成门槛。
 * @param facts 模型返回且已通过结构 Schema 的记忆候选。
 * @param inputs 当前批次允许引用的不可变输入。
 * @returns 稳定排序、去重且满足形成门槛的记忆事实。
 * @throws 模型引用不存在或输入来源不受支持时拒绝整个结果。
 */
export function validateAndMergeMemoryFacts(
  facts: MemoryFactCandidate[],
  inputs: MemoryFactInput[],
): ValidatedMemoryFact[] {
  const inputById = new Map(inputs.map(input => [input.id, input]))
  const merged = new Map<string, MutableMemoryFact>()
  for (const fact of facts) {
    const evidence = validateMemoryEvidence(fact.evidence, inputById)
    const key = `${fact.memoryType}:${normalizeStatement(fact.statement)}`
    const current = merged.get(key)
    if (current) mergeMemoryFact(current, fact, evidence)
    else merged.set(key, {
      statement: fact.statement,
      memoryType: fact.memoryType,
      evidence: new Map(evidence.map(item => [item.inputId, item])),
      confidence: fact.confidence,
      conflicts: new Set(fact.conflicts),
    })
  }
  const validated = [...merged.values()]
    .filter(meetsEvidenceThreshold)
    .map(toValidatedMemoryFact)
  return validated
}

/** 合并过程中使用的可变记忆事实。 */
interface MutableMemoryFact {
  /** 首次出现的候选陈述。 */
  statement: string
  /** 候选记忆类型。 */
  memoryType: ValidatedMemoryFact['memoryType']
  /** 按输入 UUID 去重的有效证据。 */
  evidence: Map<string, ValidatedMemoryFact['evidence'][number]>
  /** 当前最高置信度。 */
  confidence: number
  /** 去重后的冲突说明。 */
  conflicts: Set<string>
}

/**
 * 校验每项证据真实存在，并根据不可变输入类型派生证据信号。
 * @param evidence 模型返回的证据引用。
 * @param inputById 当前批次输入索引。
 * @returns 按输入 UUID 去重且已派生信号的有效证据。
 */
function validateMemoryEvidence(
  evidence: MemoryFactCandidate['evidence'],
  inputById: Map<string, MemoryFactInput>,
): ValidatedMemoryFact['evidence'] {
  const valid = new Map<string, ValidatedMemoryFact['evidence'][number]>()
  for (const item of evidence) {
    const input = inputById.get(item.inputId)
    if (!input) throw new ApplicationError('MODEL_OUTPUT_INVALID', '模型返回的人物记忆引用了不存在的资料', 502)
    valid.set(item.inputId, { inputId: item.inputId, signalType: signalForInput(input.inputType) })
  }
  return [...valid.values()].sort((left, right) => left.inputId.localeCompare(right.inputId))
}

/**
 * 根据不可变输入类型派生证据信号，避免模型自行提升证据权重。
 * @param inputType 批次输入业务类型。
 * @returns 输入类型对应的固定证据信号。
 * @throws 输入类型不属于人物记忆事实源时拒绝模型结果。
 */
function signalForInput(inputType: string): MemoryEvidenceSignal {
  if (inputType === 'persona_external_record') return 'external_record'
  if (inputType === 'persona_operation_record') return 'task_result'
  throw new ApplicationError('MODEL_OUTPUT_INVALID', '模型返回的人物记忆引用了不支持的资料类型', 502)
}

/**
 * 把相同类型与陈述的候选合并到首次出现的事实。
 * @param target 当前合并结果。
 * @param source 新候选。
 * @param evidence 已校验的新证据。
 * @returns 合并完成时结束。
 */
function mergeMemoryFact(
  target: MutableMemoryFact,
  source: MemoryFactCandidate,
  evidence: ValidatedMemoryFact['evidence'],
): void {
  for (const item of evidence) target.evidence.set(item.inputId, item)
  for (const conflict of source.conflicts) target.conflicts.add(conflict)
  target.confidence = Math.max(target.confidence, source.confidence)
}

/**
 * 判断候选是否达到对应记忆类型的独立证据门槛。
 * @param fact 已合并候选。
 * @returns 满足门槛时为 true。
 */
function meetsEvidenceThreshold(fact: MutableMemoryFact): boolean {
  const evidence = [...fact.evidence.values()]
  if (fact.memoryType === 'experience') return evidence.length >= 1
  if (fact.memoryType === 'judgment') return evidence.length >= 3
  return evidence.length >= 2
}

/**
 * 把内部合并结果转换为只读综合步骤输入。
 * @param fact 已满足门槛的合并事实。
 * @returns 独立证据数和稳定排序均已固定的记忆事实。
 */
function toValidatedMemoryFact(fact: MutableMemoryFact): ValidatedMemoryFact {
  const evidence = [...fact.evidence.values()].sort((left, right) => left.inputId.localeCompare(right.inputId))
  return {
    statement: fact.statement,
    memoryType: fact.memoryType,
    evidence,
    independentEvidenceCount: evidence.length,
    confidence: fact.confidence,
    conflicts: [...fact.conflicts].sort(),
  }
}

/**
 * 生成仅用于完全相同语义文本去重的稳定键。
 * @param statement 原始候选陈述。
 * @returns 去除多余空白并统一大小写的文本。
 */
function normalizeStatement(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}
