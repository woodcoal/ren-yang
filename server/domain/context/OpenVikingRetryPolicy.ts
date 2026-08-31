/** OpenViking 同步任务在转入人工处理前允许的最大领取次数。 */
export const OPEN_VIKING_SYNC_MAX_ATTEMPTS = 10

/** 按连续失败次数递增的持久重试间隔。 */
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000] as const

/**
 * 计算 OpenViking 临时故障后的下一次重试间隔。
 * @param failureCount 从 1 开始的连续失败次数。
 * @returns 对应的毫秒间隔；超过既定档位后固定为六小时。
 */
export function calculateOpenVikingRetryDelay(failureCount: number): number {
  const index = Math.max(0, Math.min(Math.trunc(failureCount) - 1, RETRY_DELAYS_MS.length - 1))
  return RETRY_DELAYS_MS[index]!
}
