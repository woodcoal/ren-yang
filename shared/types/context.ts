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
  /** 首次创建时间。 */
  createdAt: number
  /** 最近同步时间。 */
  updatedAt: number
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
