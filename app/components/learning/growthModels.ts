import type { GrowthMaterialView, GrowthRecordView } from '#shared/types/learning'

/** 成长资料导入弹窗使用的只读来源。 */
export interface GrowthSourceOption {
  /** 来源 UUID。 */
  id: string
  /** 来源展示名称。 */
  label: string
  /** 将由服务端重新读取并导入的当前正文。 */
  content: string
  /** 来源当前是否允许参加普通任务检索；不影响人工导入。 */
  isEnabled: boolean
  /** 当前来源是否已经进入成长素材池。 */
  isImported?: boolean
}

/** 旧成长修订弹窗兼容提交内容；新页面不再使用。 */
export interface GrowthEditorSubmission {
  /** 稳定成长 UUID。 */
  id: string
  /** 成长正文。 */
  content: string
  /** 重要程度，1–5。 */
  importance: number
}

/** 新增或修改成长素材弹窗提交内容。 */
export interface GrowthMaterialEditorSubmission {
  /** 修改时的成长素材 UUID；新增时为空。 */
  id?: string
  /** 素材标题。 */
  title: string
  /** 素材正文。 */
  content: string
  /** AI 提炼权重，1–5。 */
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

/** 成长编辑弹窗接收的当前素材快照。 */
export type EditableGrowthMaterial = GrowthMaterialView

/** 旧成长修订弹窗兼容类型；新页面不再使用。 */
export type EditableGrowthRecord = GrowthRecordView
