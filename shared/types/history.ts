import type { HistoryKind, HistoryStatus } from '../schemas/history'

/** 任务记录页统一展示的一项生成运行或分析批次。 */
export interface HistoryItemView {
  /** 两类任务记录的来源。 */
  sourceType: 'run' | 'analysis'
  /** 生成运行或分析批次 UUID。 */
  id: string
  /** 任务类型。 */
  kind: HistoryKind
  /** 任务所属人物或世界。 */
  subjectType: 'persona' | 'world'
  /** 任务所属对象 UUID。 */
  subjectId: string
  /** 当前对象名称；对象已删除时返回稳定占位名称。 */
  subjectName: string
  /** 当前对象是否仍存在。 */
  subjectExists: boolean
  /** 当前执行或审核状态。 */
  status: HistoryStatus
  /** 任务输入、提炼结果或失败原因摘要。 */
  description: string
  /** 模型名称或分析模式说明。 */
  secondary: string
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
}

/** 服务端分页后的统一任务记录。 */
export interface HistoryPageView {
  /** 当前页任务记录。 */
  items: HistoryItemView[]
  /** 符合筛选条件的全部任务数量。 */
  total: number
  /** 服务端确认后的当前页码，从 1 开始。 */
  page: number
  /** 当前每页数量。 */
  pageSize: 5 | 10 | 20 | 50 | 100
  /** 总页数；空列表时仍为 1。 */
  totalPages: number
}
