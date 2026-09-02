/** 人物蒸馏运行的全部稳定状态。 */
export const PERSONA_DISTILLATION_STATUSES = [
  'assessing_sources',
  'awaiting_source_review',
  'extracting',
  'synthesizing',
  'evaluating',
  'awaiting_candidate_review',
  'completed',
  'failed',
  'canceled',
] as const

/** 人物蒸馏运行的稳定状态。 */
export type PersonaDistillationStatus = typeof PERSONA_DISTILLATION_STATUSES[number]

/** 人物蒸馏算法固定的四个模型步骤及执行顺序。 */
export const PERSONA_DISTILLATION_ALGORITHM_STEPS = [
  'classify_sources',
  'extract_claims',
  'synthesize_soul',
  'evaluate_soul',
] as const

/** 人物蒸馏算法的固定模型步骤编码。 */
export type PersonaDistillationAlgorithmStep = typeof PERSONA_DISTILLATION_ALGORITHM_STEPS[number]

/** 已导入资料与目标人物之间允许使用的来源关系。 */
export const PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS = [
  'subject_authored',
  'direct_conversation',
  'observed_decision',
  'subject_social',
  'third_party',
] as const

/** 已导入资料与目标人物之间允许使用的来源关系。 */
export type PersonaDistillationMaterialSourceRelation = typeof PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS[number]

/** 资料或用户明确要求与目标人物之间的来源关系。 */
export const PERSONA_DISTILLATION_SOURCE_RELATIONS = [
  ...PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS,
  'user_statement',
] as const

/** 资料或用户明确要求与目标人物之间的来源关系。 */
export type PersonaDistillationSourceRelation = typeof PERSONA_DISTILLATION_SOURCE_RELATIONS[number]

/** 人物蒸馏资料能够覆盖的分析维度。 */
export const PERSONA_DISTILLATION_COVERAGE_DIMENSIONS = [
  'writings',
  'conversations',
  'expression',
  'external_views',
  'decisions',
  'timeline',
] as const

/** 人物蒸馏资料能够覆盖的分析维度。 */
export type PersonaDistillationCoverageDimension = typeof PERSONA_DISTILLATION_COVERAGE_DIMENSIONS[number]

/** 人物蒸馏能够形成的结构化认知候选分类。 */
export const PERSONA_DISTILLATION_CLAIM_CATEGORIES = [
  'mental_model',
  'decision_heuristic',
  'expression',
  'value',
  'anti_pattern',
  'tension',
  'honesty_boundary',
  'timeline',
] as const

/** 人物蒸馏能够形成的结构化认知候选分类。 */
export type PersonaDistillationClaimCategory = typeof PERSONA_DISTILLATION_CLAIM_CATEGORIES[number]

/** 认知候选与资料之间的推导关系。 */
export const PERSONA_DISTILLATION_CLAIM_BASES = ['explicit', 'observed', 'inferred'] as const

/** 认知候选与资料之间的推导关系。 */
export type PersonaDistillationClaimBasis = typeof PERSONA_DISTILLATION_CLAIM_BASES[number]

/** 证据对候选结论的支持方向。 */
export const PERSONA_DISTILLATION_EVIDENCE_RELATIONS = ['supporting', 'opposing'] as const

/** 证据对候选结论的支持方向。 */
export type PersonaDistillationEvidenceRelation = typeof PERSONA_DISTILLATION_EVIDENCE_RELATIONS[number]
