import type { ApiKeyScope } from '../../shared/schemas/publicApi'

/** 数据库保存的 API Key 记录；不得包含可恢复明文。 */
export interface ApiKeyRecord {
  id: string
  name: string
  keyPrefix: string
  keyDigest: string
  scopes: ApiKeyScope[]
  expiresAt: number | null
  lastUsedAt: number | null
  revokedAt: number | null
  createdAt: number
}

/** 新建 API Key 的不可逆持久化记录。 */
export type NewApiKeyRecord = ApiKeyRecord

/** API Key 持久化端口。 */
export interface ApiKeyRepository {
  /** @param record 不包含明文的新 Key。 @returns 写入完成时结束。 */
  create(record: NewApiKeyRecord): Promise<void>
  /** @returns 新记录在前的全部 Key。 */
  list(): Promise<ApiKeyRecord[]>
  /** @param digest 完整 Key 的 SHA-256 摘要。 @returns 对应记录或 null。 */
  findByDigest(digest: string): Promise<ApiKeyRecord | null>
  /** @param id Key 标识。 @param timestamp 吊销时间。 @returns 是否首次吊销。 */
  revoke(id: string, timestamp: number): Promise<boolean>
  /** @param id Key 标识。 @param timestamp 最近成功认证时间。 @returns 是否更新。 */
  markUsed(id: string, timestamp: number): Promise<boolean>
}
