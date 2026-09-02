import type { LearningAutomationSettingsView } from '../../shared/types/learningAutomation'

/** 学习自动化单例设置与跨进程周期领取端口。 */
export interface LearningAutomationSettingsRepository {
  /** @returns 当前持久化周期设置。 */
  find(): Promise<LearningAutomationSettingsView>
  /** @param intervalHours 新周期小时数。 @param timestamp 保存时间。 @returns 更新后的设置。 */
  update(intervalHours: number, timestamp: number): Promise<LearningAutomationSettingsView>
  /** @param timestamp 当前时间。 @returns 本次是否原子领取到到期周期。 */
  claimDueCycle(timestamp: number): Promise<boolean>
}
