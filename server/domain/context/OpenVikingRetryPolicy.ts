/** OpenViking 同步意图在停止自动重试前允许的最大领取次数。 */
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

/**
 * 判断错误是否来自重试无法改变结果的单项嵌入输入长度限制。
 * @param message OpenViking 返回或 SQLite 持久化的脱敏错误文本。
 * @returns 属于单项输入长度错误时返回 true。
 */
export function isOpenVikingInputLimitError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('exceed_context_size_error') || normalized.includes('exceeds the available context size')
}

/**
 * 判断错误是否来自旧版本把 OpenViking 资料目录当作普通文件删除。
 * @param message OpenViking 返回或 SQLite 持久化的脱敏错误文本。
 * @returns 属于缺少递归目录删除参数的客户端契约错误时返回 true。
 */
export function isOpenVikingDirectoryDeleteModeError(message: string): boolean {
  return message.toLowerCase().includes('cannot remove directory without --recursive')
}
