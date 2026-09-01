import type { SystemAiSettingsValues } from '../../shared/schemas/systemAi'
import type { SystemAiSettingsView } from '../../shared/types/systemAi'

/** 全站默认文本与图片模型的持久化端口。 */
export interface SystemAiSettingsRepository {
  /** @returns 已保存设置；尚未保存时返回 null。 */
  find(): Promise<SystemAiSettingsView | null>
  /** @param values 两类默认模型的完整选择。 @param timestamp 保存时间。 @returns 保存后的设置。 */
  save(values: SystemAiSettingsValues, timestamp: number): Promise<SystemAiSettingsView>
}
