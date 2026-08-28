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
}
