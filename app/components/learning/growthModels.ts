import type { GrowthRecordView } from '#shared/types/learning'

/** 成长资料导入弹窗使用的只读来源。 */
export interface GrowthSourceOption {
  /** 来源 UUID。 */
  id: string
  /** 来源展示名称。 */
  label: string
  /** 将由服务端重新读取并导入的当前正文。 */
  content: string
  /** 来源当前是否参加自动成长分析；人工导入不受此状态限制。 */
  isEnabled: boolean
}

/** 修改成长弹窗提交内容。 */
export interface GrowthEditorSubmission {
  /** 稳定成长 UUID。 */
  id: string
  /** 成长正文。 */
  content: string
  /** 重要程度，1–5。 */
  importance: number
}

/** 单份资料的导入评分。 */
export interface GrowthImportItem {
  /** 来源 UUID。 */
  sourceId: string
  /** 人工评分，直接映射为成长重要程度。 */
  importance: number
}

/** 资料批量导入弹窗提交内容。 */
export interface GrowthImportSubmission {
  /** 保持界面顺序的来源评分。 */
  items: GrowthImportItem[]
}

/** 成长编辑弹窗接收的当前修订。 */
export type EditableGrowthRecord = GrowthRecordView
