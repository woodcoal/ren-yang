/** 后台统一学习自动化周期视图。 */
export interface LearningAutomationSettingsView {
  /** 两次到期扫描之间的小时数。 */
  intervalHours: number
  /** 下次允许扫描的 UTC Unix 毫秒时间。 */
  nextRunAt: number
  /** 上次成功领取扫描周期的时间；尚未运行时为空。 */
  lastRunAt: number | null
  /** 设置最后更新时间。 */
  updatedAt: number
}
