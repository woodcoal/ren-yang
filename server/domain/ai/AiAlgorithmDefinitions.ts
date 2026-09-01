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

/** 首批算法的固定流程；数据库只能为这些步骤选择模型和参数。 */
export const AI_ALGORITHM_DEFINITIONS: Record<AiAlgorithmCode, AiAlgorithmDefinition> = {
  persona_soul: {
    code: 'persona_soul', name: '人物灵魂整理', implementationVersion: 1,
    description: '把人物灵魂原文整理为不增加事实的固定提示词。',
    steps: [{ key: 'organize', name: '整理', description: '整理人物灵魂原文。', promptCode: 'content.persona_soul_analysis', ordinal: 0 }],
  },
  world_soul: {
    code: 'world_soul', name: '世界灵魂整理', implementationVersion: 1,
    description: '把世界灵魂原文整理为不增加事实的固定提示词。',
    steps: [{ key: 'organize', name: '整理', description: '整理世界灵魂原文。', promptCode: 'content.world_soul_analysis', ordinal: 0 }],
  },
  persona_growth: {
    code: 'persona_growth', name: '人物成长提炼', implementationVersion: 1,
    description: '先提取带证据的原子结论，再综合为待审核的人物成长提示词草稿。',
    steps: [
      { key: 'extract', name: '原子提取', description: '从资料提取带证据引用的原子结论。', promptCode: 'analysis.persona_growth_extract', ordinal: 0 },
      { key: 'synthesize', name: '综合编译', description: '把已校验结论编译为完整成长提示词草稿。', promptCode: 'analysis.persona_growth_synthesize', ordinal: 1 },
    ],
  },
  world_growth: {
    code: 'world_growth', name: '世界成长提炼', implementationVersion: 1,
    description: '先提取带证据的原子结论，再综合为待审核的世界成长提示词草稿。',
    steps: [
      { key: 'extract', name: '原子提取', description: '从资料提取带证据引用的原子世界结论。', promptCode: 'analysis.world_growth_extract', ordinal: 0 },
      { key: 'synthesize', name: '综合编译', description: '把已校验结论编译为完整世界成长提示词草稿。', promptCode: 'analysis.world_growth_synthesize', ordinal: 1 },
    ],
  },
  persona_memory: {
    code: 'persona_memory', name: '人物记忆提炼', implementationVersion: 1,
    description: '提取可追溯的记忆证据，经独立来源门槛校验后编译为待审核的人物记忆提示词草稿。',
    steps: [
      { key: 'extract', name: '证据提取', description: '从历史任务与第三方经历提取带信号类型的原子记忆候选。', promptCode: 'analysis.persona_memory_extract', ordinal: 0 },
      { key: 'synthesize', name: '记忆编译', description: '把通过独立证据门槛的事实编译为完整人物记忆提示词草稿。', promptCode: 'analysis.persona_memory_synthesize', ordinal: 1 },
    ],
  },
  article_generation: {
    code: 'article_generation', name: '文章生成', implementationVersion: 1,
    description: '结合人物个性、创作条件和有效资料一次生成完整文章。',
    steps: [
      { key: 'generate', name: '生成文章', description: '一次生成最终标题、摘要和全部正文段落。', promptCode: 'generation.article', ordinal: 0 },
    ],
  },
  article_image_analysis: {
    code: 'article_image_analysis', name: '文章配图分析', implementationVersion: 1,
    description: '根据最终文章分析指定数量配图的内容与正文插入位置。',
    steps: [
      { key: 'analyze', name: '分析配图', description: '确定每张配图的视觉要求和段落插入位置。', promptCode: 'generation.article_images', ordinal: 0 },
    ],
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
