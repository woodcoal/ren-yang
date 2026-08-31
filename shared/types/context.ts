/** OpenViking 的非敏感配置与健康状态。 */
export interface OpenVikingCapabilityView {
  /** 接口地址与访问凭据是否配置完整。 */
  configured: boolean
  /** 是否选择 OpenViking 作为新运行的上下文提供器。 */
  enabled: boolean
  /** 固定提供器标识。 */
  provider: 'openviking'
  /** 不包含路径、查询和凭据的接口来源。 */
  endpointOrigin: string | null
}

/** 后台可读取且不包含明文或密文 ADMIN Key 的 OpenViking 设置。 */
export interface OpenVikingSettingsView {
  /** 是否选择 OpenViking 供新运行检索与异步同步。 */
  enabled: boolean
  /** 服务根地址；未配置时为空字符串。 */
  endpoint: string
  /** 数据库是否已有加密 ADMIN Key。 */
  hasApiKey: boolean
  /** 单次 HTTP 请求超时毫秒数。 */
  timeoutMs: number
  /** 最近保存时间；尚未保存时为空。 */
  updatedAt: number | null
}
/** 一项 SQLite 资料对 OpenViking 的同步事实。 */
export interface ContextSyncRecordView {
  /** 同步记录 UUID。 */
  id: string
  /** SQLite 投影实体类型。 */
  entityType: 'source_material' | 'persona_feedback_source' | 'growth' | 'memory'
  /** SQLite 投影实体 UUID。 */
  sourceId: string
  /** 远端投影所属范围；世界资料进入 User，人物资料进入 Peer。 */
  scopeType: 'world' | 'persona'
  /** 世界或人物 UUID。 */
  scopeId: string
  /** OpenViking 中承载当前投影的世界 User。 */
  userId: string
  /** 人物投影对应的 Peer；世界投影为空。 */
  peerId: string | null
  /** 固定提供器。 */
  provider: 'openviking'
  /** OpenViking 资源 URI。 */
  remoteUri: string | null
  /** 同步目标正文哈希。 */
  contentHash: string
  /** 当前同步状态。 */
  status: 'pending' | 'synchronized' | 'failed'
  /** 当前期望远端执行的操作。 */
  operation: 'upsert' | 'delete'
  /** 脱敏错误摘要。 */
  error: string | null
  /** OpenViking 返回的稳定错误代码；本地或未知异常为空。 */
  errorCode: string | null
  /** 不含 URI、正文和凭据的请求阶段。 */
  errorStage: string | null
  /** 当前投影连续失败次数；同步成功后归零。 */
  failureCount: number
  /** 下一次自动重试时间；失败且为空表示需要管理员处理。 */
  nextRetryAt: number | null
  /** 首次创建时间。 */
  createdAt: number
  /** 最近同步时间。 */
  updatedAt: number
}

/** OpenViking 写入同步熔断状态。 */
export interface OpenVikingSyncRuntimeView {
  /** 健康时允许远端检索和写入；降级时新任务使用 SQLite。 */
  state: 'healthy' | 'degraded'
  /** 连续外部故障次数；成功写入后归零。 */
  consecutiveFailures: number
  /** 下一次允许 Worker 探测远端写入的时间。 */
  retryAfter: number | null
  /** 最近一次脱敏错误摘要。 */
  lastError: string | null
  /** 最近状态变化时间；尚无状态记录时为空。 */
  updatedAt: number | null
}

/** 管理界面使用的 OpenViking 当前同步摘要。 */
export interface ContextSyncSummaryView {
  /** 当前所有失败投影数量。 */
  failedCount: number
  /** 已安排自动重试的失败投影数量。 */
  retryingCount: number
  /** 已停止自动重试、需要管理员处理的投影数量。 */
  attentionCount: number
  /** 全局写入与检索降级状态。 */
  runtime: OpenVikingSyncRuntimeView
}

/** 管理界面使用的 OpenViking 同步日志分页结果。 */
export interface ContextSyncRecordPageView {
  /** 当前页同步日志。 */
  items: ContextSyncRecordView[]
  /** 同步日志总数。 */
  total: number
  /** 实际返回页码；请求越界时收敛到最后一页。 */
  page: number
  /** 当前每页数量。 */
  pageSize: 5 | 10 | 20 | 50 | 100
  /** 总页数；无记录时为 1。 */
  totalPages: number
}

/** OpenViking 全量重建结果。 */
export interface ContextReindexResult {
  /** 固定目标提供器。 */
  provider: 'openviking'
  /** SQLite 中参与重建的资料数。 */
  total: number
  /** 成功写入数。 */
  synchronized: number
  /** 失败数。 */
  failed: number
  /** 每项资料的最终同步事实。 */
  records: ContextSyncRecordView[]
}
