import type { AuditEventPageView, AuditEventView } from '../../shared/types/system'

/** 审计记录分页查询参数。 */
export interface ListAuditEventPageInput {
  /** 从 1 开始的页码。 */
  page: number
  /** 每页记录数。 */
  pageSize: 5 | 10 | 20 | 50 | 100
}

/** 可持久化的关键审计动作。 */
export interface AuditEventRecord {
  /** 动作发起主体。 */
  actor: AuditEventView['actor']
  /** 稳定动作名称。 */
  action: string
  /** 被操作资源类型。 */
  targetType: string
  /** 可选资源标识。 */
  targetId: string | null
  /** 不含正文和凭据的摘要。 */
  details?: Record<string, unknown>
  /** UTC Unix 毫秒。 */
  timestamp: number
}

/** 关键动作审计读取端口。 */
export interface AuditRepository {
  /** @param limit 最大返回数量。 @returns 新记录在前的审计历史。 */
  list(limit: number): Promise<AuditEventView[]>
  /** @param input 分页参数。 @returns 新记录在前的审计分页结果。 */
  listPage(input: ListAuditEventPageInput): Promise<AuditEventPageView>
}
