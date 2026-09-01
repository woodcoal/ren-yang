import type { OpenVikingCapabilityView } from './context'
import type { ImageModelCapability, TextModelCapability } from './generation'
import type { TextModelParameters } from '../schemas/generation'

/** 管理界面可见的外部能力与默认运行参数。 */
export interface SystemCapabilitiesResult {
  /** 当前可用文本算法使用的代表性非敏感模型快照。 */
  textModel: TextModelCapability
  /** 当前可用图文算法使用的非敏感图片模型快照。 */
  imageModel: ImageModelCapability
  /** 工作台按真实固定算法链判定的可用能力。 */
  algorithmCapabilities: {
    /** 完整文章生成与正文保存链是否可用。 */
    articleGeneration: boolean
    /** 配图分析与图片生成链是否可用。 */
    articleImageGeneration: boolean
    /** 批量兴趣判定算法是否可用。 */
    interestAssessment: boolean
  }
  /** OpenViking 非敏感配置状态。 */
  openViking: OpenVikingCapabilityView
  /** 新运行实际使用的上下文提供器。 */
  contextProvider: 'sqlite_fts5' | 'openviking'
  /** 由代码固定并写入新运行快照的安全参数。 */
  defaultParameters: TextModelParameters
}

/** 管理界面可见的 SQLite 健康摘要。 */
export interface PublicDatabaseHealth {
  /** SQLite 是否通过关键配置和完整性检查。 */
  healthy: boolean
  /** 当前 SQLite 日志模式。 */
  journalMode: string
  /** 外键约束是否启用。 */
  foreignKeysEnabled: boolean
  /** 完整性检查结果。 */
  integrity: string
}

/** 管理界面可见的 Worker 状态。 */
export interface PublicWorkerStatus {
  /** Worker 是否正在轮询。 */
  running: boolean
  /** 当前任务标识。 */
  activeJobId: string | null
  /** 最后轮询时间。 */
  lastPollAt: number | null
  /** 最近一次安全错误摘要。 */
  lastError: string | null
}

/** 管理界面可见的持久任务队列摘要。 */
export interface PublicTaskQueueStatus {
  /** 尚未领取且会出现在任务记录中的用户任务数量。 */
  userQueued: number
  /** 尚未领取的任务数量。 */
  queued: number
  /** 已被当前 Worker 领取的任务数量。 */
  running: number
  /** 正等待 Worker 协作取消的任务数量。 */
  cancelRequested: number
  /** 以上三种未终止任务的合计。 */
  total: number
}

/** 管理界面使用的系统健康结果。 */
export interface SystemHealthResult {
  /** 应用整体是否可用。 */
  healthy: boolean
  /** 是否需要首次创建管理员。 */
  setupRequired: boolean
  /** SQLite 健康摘要，不包含绝对文件路径。 */
  database: PublicDatabaseHealth
  /** 当前进程内 Worker 状态。 */
  worker: PublicWorkerStatus
  /** SQLite 中尚未终止的持久任务队列摘要。 */
  taskQueue: PublicTaskQueueStatus
}

/** 管理界面可见的关键动作审计记录。 */
export interface AuditEventView {
  /** 审计 UUID。 */
  id: string
  /** 动作发起主体。 */
  actor: 'administrator' | 'maintenance' | 'system' | 'api_key'
  /** 稳定动作名称。 */
  action: string
  /** 被操作资源类型。 */
  targetType: string
  /** 被操作资源标识；全局动作可以为空。 */
  targetId: string | null
  /** 不含正文或凭据的结构化摘要。 */
  details: Record<string, unknown>
  /** UTC Unix 毫秒。 */
  createdAt: number
}

/** 管理界面使用的审计记录分页结果。 */
export interface AuditEventPageView {
  /** 当前页审计记录。 */
  items: AuditEventView[]
  /** 符合条件的审计记录总数。 */
  total: number
  /** 实际返回页码；请求越界时收敛到最后一页。 */
  page: number
  /** 当前每页数量。 */
  pageSize: 5 | 10 | 20 | 50 | 100
  /** 总页数；无记录时为 1。 */
  totalPages: number
}
