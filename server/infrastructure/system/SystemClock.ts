import type { Clock } from '../../ports/Clock'

/** 使用系统 UTC 时间实现时钟端口。 */
export class SystemClock implements Clock {
  /**
   * 读取当前 UTC Unix 毫秒。
   * @returns 当前时间。
   */
  now(): number {
    return Date.now()
  }
}
