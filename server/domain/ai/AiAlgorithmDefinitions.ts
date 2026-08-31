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
}

/**
 * 读取一个存在的固定算法定义。
 * @param code 待查询的稳定算法编码。
 * @returns 对应的不可变算法定义。
 */
export function getAiAlgorithmDefinition(code: AiAlgorithmCode): AiAlgorithmDefinition {
  return AI_ALGORITHM_DEFINITIONS[code]
}
