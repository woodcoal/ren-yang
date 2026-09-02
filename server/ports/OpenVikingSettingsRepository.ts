import type { OpenVikingSettingsView } from '../../shared/types/context'

/** 仅供服务端解密使用的 OpenViking 设置记录。 */
export interface OpenVikingSettingsSecretRecord extends OpenVikingSettingsView {
  /** ADMIN Key 的 AES-GCM 版本化密文；尚未配置时为空字符串。 */
  apiKeyCiphertext: string
}

/** 保存 OpenViking 单例配置所需的完整记录。 */
export interface SaveOpenVikingSettingsRecord {
  /** 是否启用 OpenViking。 */
  enabled: boolean
  /** 服务根地址。 */
  endpoint: string
  /** OpenViking 中承载本系统世界 User 的 Account 标识。 */
  accountId: string
  /** ADMIN Key 密文。 */
  apiKeyCiphertext: string
  /** 请求超时毫秒数。 */
  timeoutMs: number
  /** 保存时间。 */
  timestamp: number
}

/** OpenViking 加密设置持久化端口。 */
export interface OpenVikingSettingsRepository {
  /** @returns 当前含密文设置；尚未保存时返回 null。 */
  find(): Promise<OpenVikingSettingsSecretRecord | null>
  /** @returns 当前含密文设置的同步读取结果，供运行时适配器调用。 */
  findCurrent(): OpenVikingSettingsSecretRecord | null
  /** @param record 完整替换记录。 @returns 保存后的脱敏设置。 */
  save(record: SaveOpenVikingSettingsRecord): Promise<OpenVikingSettingsView>
}
