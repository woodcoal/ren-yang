import type { AiAlgorithmCode, AiAlgorithmStepDefinitionView } from '../../../shared/types/aiConfiguration'

/** 一项不可由数据库改变流程的算法定义。 */
export interface AiAlgorithmDefinition {
  /** 稳定算法编码。 */
  code: AiAlgorithmCode
  /** 中文名称。 */
  name: string
  /** 用途说明。 */
  description: string
  /** 代码实现版本。 */
  implementationVersion: number
  /** 固定步骤及执行顺序。 */
  steps: AiAlgorithmStepDefinitionView[]
}

/** 全部算法的固定流程；数据库只能为这些步骤选择模型和参数。 */
export const AI_ALGORITHM_DEFINITIONS: Record<AiAlgorithmCode, AiAlgorithmDefinition> = {
  persona_soul: {
    code: 'persona_soul', name: '人物灵魂整理', implementationVersion: 1,
    description: '把人物灵魂原文整理为不增加事实的固定提示词。',
    steps: [{ key: 'organize', name: '整理', description: '整理人物灵魂原文。', promptCode: 'content.persona_soul_analysis', modality: 'text', ordinal: 0 }],
  },
  world_soul: {
    code: 'world_soul', name: '世界灵魂整理', implementationVersion: 1,
    description: '把世界灵魂原文整理为不增加事实的固定提示词。',
    steps: [{ key: 'organize', name: '整理', description: '整理世界灵魂原文。', promptCode: 'content.world_soul_analysis', modality: 'text', ordinal: 0 }],
  },
  persona_growth: {
    code: 'persona_growth', name: '人物成长提炼', implementationVersion: 1,
    description: '先提取带证据的原子结论，再综合为待审核的人物成长提示词草稿。',
    steps: [
      { key: 'extract', name: '原子提取', description: '从资料提取带证据引用的原子结论。', promptCode: 'analysis.persona_growth_extract', modality: 'text', ordinal: 0 },
      { key: 'synthesize', name: '综合编译', description: '把已校验结论编译为完整成长提示词草稿。', promptCode: 'analysis.persona_growth_synthesize', modality: 'text', ordinal: 1 },
    ],
  },
  world_growth: {
    code: 'world_growth', name: '世界成长提炼', implementationVersion: 1,
    description: '先提取带证据的原子结论，再综合为待审核的世界成长提示词草稿。',
    steps: [
      { key: 'extract', name: '原子提取', description: '从资料提取带证据引用的原子世界结论。', promptCode: 'analysis.world_growth_extract', modality: 'text', ordinal: 0 },
      { key: 'synthesize', name: '综合编译', description: '把已校验结论编译为完整世界成长提示词草稿。', promptCode: 'analysis.world_growth_synthesize', modality: 'text', ordinal: 1 },
    ],
  },
  persona_memory: {
    code: 'persona_memory', name: '人物记忆提炼', implementationVersion: 1,
    description: '提取可追溯的记忆证据，经独立来源门槛校验后编译为待审核的人物记忆提示词草稿。',
    steps: [
      { key: 'extract', name: '证据提取', description: '从历史任务与第三方经历提取带输入证据引用的原子记忆候选。', promptCode: 'analysis.persona_memory_extract', modality: 'text', ordinal: 0 },
      { key: 'synthesize', name: '记忆编译', description: '把通过独立证据门槛的事实编译为完整人物记忆提示词草稿。', promptCode: 'analysis.persona_memory_synthesize', modality: 'text', ordinal: 1 },
    ],
  },
  persona_draft: {
    code: 'persona_draft', name: '人物草稿生成', implementationVersion: 1,
    description: '根据用户要求、可选世界和资料生成待确认的人物初始草稿。',
    steps: [{ key: 'generate', name: '生成草稿', description: '一次生成人物名称、灵魂和版本说明。', promptCode: 'generation.persona_draft', modality: 'text', ordinal: 0 }],
  },
  persona_distillation: {
    code: 'persona_distillation', name: '人物蒸馏', implementationVersion: 1,
    description: '评估资料覆盖，提取并校验证据候选，综合单文本灵魂并评测人物候选。',
    steps: [
      { key: 'classify_sources', name: '资料分类', description: '识别来源关系、覆盖维度和同源分组。', promptCode: 'distillation.classify_sources', modality: 'text', ordinal: 0 },
      { key: 'extract_claims', name: '认知提取', description: '从确认资料提取带精确引文的认知候选。', promptCode: 'distillation.extract_claims', modality: 'text', ordinal: 1 },
      { key: 'synthesize_soul', name: '灵魂综合', description: '把已校验候选编译为完整人物候选草稿。', promptCode: 'distillation.synthesize_soul', modality: 'text', ordinal: 2 },
      { key: 'evaluate_soul', name: '候选评测', description: '按六类固定维度评测当前候选及诚实边界。', promptCode: 'distillation.evaluate_soul', modality: 'text', ordinal: 3 },
    ],
  },
  world_draft: {
    code: 'world_draft', name: '世界草稿生成', implementationVersion: 1,
    description: '根据用户要求生成待确认的世界初始草稿。',
    steps: [{ key: 'generate', name: '生成草稿', description: '一次生成世界名称、灵魂和版本说明。', promptCode: 'generation.world_draft', modality: 'text', ordinal: 0 }],
  },
  feedback_classification: {
    code: 'feedback_classification', name: '反馈分类', implementationVersion: 1,
    description: '判断用户反馈影响当前产物、参数建议、人物成长还是资料事实。',
    steps: [{ key: 'classify', name: '分类反馈', description: '输出待用户确认的反馈归属建议。', promptCode: 'feedback.classification', modality: 'text', ordinal: 0 }],
  },
  persona_avatar: {
    code: 'persona_avatar', name: '人物头像生成', implementationVersion: 1,
    description: '根据人物名称、当前灵魂和补充视觉要求生成头像。',
    steps: [{ key: 'generate', name: '生成头像', description: '生成并保存固定 1:1 的人物头像。', promptCode: 'content.persona_avatar', modality: 'image', ordinal: 0 }],
  },
  interest_assessment: {
    code: 'interest_assessment', name: '兴趣判定', implementationVersion: 1,
    description: '以固定人物快照一次判定一条或多条文本，并逐项返回三态结论与证据。',
    steps: [
      { key: 'assess', name: '批量判定', description: '按客户端稳定编号逐项输出兴趣结论。', promptCode: 'generation.interest_assessment', modality: 'text', ordinal: 0 },
    ],
  },
  article_generation: {
    code: 'article_generation', name: '文章生成', implementationVersion: 1,
    description: '结合人物个性、创作条件和有效资料一次生成完整文章。',
    steps: [
      { key: 'generate', name: '生成文章', description: '一次生成最终标题、摘要和全部正文段落。', promptCode: 'generation.article', modality: 'text', ordinal: 0 },
    ],
  },
  article_image_analysis: {
    code: 'article_image_analysis', name: '文章配图分析', implementationVersion: 1,
    description: '根据最终文章分析指定数量配图的内容与正文插入位置。',
    steps: [
      { key: 'analyze', name: '分析配图', description: '确定每张配图的视觉要求和段落插入位置。', promptCode: 'generation.article_images', modality: 'text', ordinal: 0 },
    ],
  },
  article_text_revision: {
    code: 'article_text_revision', name: '文章正文修正', implementationVersion: 1,
    description: '根据用户反馈重新生成指定文章段落。',
    steps: [{ key: 'revise', name: '修正段落', description: '结合文章上下文和修正要求重新生成目标段落。', promptCode: 'generation.text_block', modality: 'text', ordinal: 0 }],
  },
  article_image_generation: {
    code: 'article_image_generation', name: '文章图片生成', implementationVersion: 1,
    description: '根据最终文章、人物个性和配图简报生成文章图片。',
    steps: [{ key: 'generate', name: '生成图片', description: '按已分析的位置和视觉要求生成一张文章图片。', promptCode: 'generation.image_block', modality: 'image', ordinal: 0 }],
  },
}

/**
 * 读取一个存在的固定算法定义。
 * @param code 待查询的稳定算法编码。
 * @returns 对应的不可变算法定义。
 */
export function getAiAlgorithmDefinition(code: AiAlgorithmCode): AiAlgorithmDefinition {
  return AI_ALGORITHM_DEFINITIONS[code]
}
