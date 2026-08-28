/** 为应用服务提供可替换时间的端口。 */
export interface Clock {
  /**
   * 返回当前 UTC Unix 毫秒。
   * @returns 当前时间的 Unix 毫秒值。
   */
  now(): number
}
