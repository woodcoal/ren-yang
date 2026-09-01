import type { SystemAiSettingsValues } from '../schemas/systemAi'

/** 模型配置页读取的全站默认模型设置。 */
export interface SystemAiSettingsView {
  /** 默认文本和图片模型部署选择。 */
  values: SystemAiSettingsValues
  /** 最近保存时间；从未保存时为空。 */
  updatedAt: number | null
}
