import type { SystemAiSettingsValues } from '../schemas/systemAi'

/** 系统 AI 参数支持的业务场景。 */
export type SystemAiOperation = keyof SystemAiSettingsValues

/** 管理界面读取的系统 AI 当前设置。 */
export interface SystemAiSettingsView {
  /** 四类系统 AI 操作的完整参数。 */
  values: SystemAiSettingsValues
  /** 最近保存时间；尚未保存自定义值时为空。 */
  updatedAt: number | null
}
