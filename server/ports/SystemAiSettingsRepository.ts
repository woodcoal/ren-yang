import type { SystemAiSettingsValues } from '../../shared/schemas/systemAi'
import type { SystemAiSettingsView } from '../../shared/types/systemAi'

/** 全局系统 AI 当前设置持久化端口。 */
export interface SystemAiSettingsRepository {
  /** @returns 已保存设置；尚未保存时返回 null。 */
  find(): Promise<SystemAiSettingsView | null>
  /** @param values 四类完整参数。 @param timestamp 保存时间。 @returns 保存后的当前设置。 */
  save(values: SystemAiSettingsValues, timestamp: number): Promise<SystemAiSettingsView>
}
