/** Worker 能够领取的任务状态。 */
export type TaskJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'canceled'

/** Worker 任务的持久化快照。 */
export interface TaskJob {
  /** 任务唯一标识。 */
  id: string
  /** 业务任务类型。 */
  type: string
  /** JSON 序列化后的任务输入。 */
  payloadJson: string
  /** 当前任务状态。 */
  status: TaskJobStatus
  /** 已领取次数。 */
  attemptCount: number
  /** 允许自动领取的最大次数。 */
  maxAttempts: number
  /** 当前租约到期时间，未领取时为 null。 */
  leaseUntil: number | null
}
