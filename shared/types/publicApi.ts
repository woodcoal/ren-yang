import type { ApiKeyScope } from '../schemas/publicApi'

/** 管理员可见但不包含摘要和明文的 API Key 信息。 */
export interface ApiKeyView {
  /** API Key 稳定标识。 */
  id: string
  /** 管理员填写的用途名称。 */
  name: string
  /** 用于人工辨认且不能完成认证的 Key 前缀。 */
  prefix: string
  /** 已授权的公共能力。 */
  scopes: ApiKeyScope[]
  /** 当前认证状态。 */
  status: 'active' | 'expired' | 'revoked'
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 可选到期时间，UTC Unix 毫秒。 */
  expiresAt: number | null
  /** 最近一次成功认证时间，UTC Unix 毫秒。 */
  lastUsedAt: number | null
  /** 可选吊销时间，UTC Unix 毫秒。 */
  revokedAt: number | null
}

/** API Key 创建成功后唯一一次包含明文的响应。 */
export interface CreatedApiKeyView {
  /** 不含摘要的 Key 管理视图。 */
  key: ApiKeyView
  /** 只在本次创建响应中出现的完整明文。 */
  secret: string
}

/** 公共请求认证后附加到请求上下文的最小主体。 */
export interface ApiKeyPrincipal {
  /** API Key 稳定标识。 */
  id: string
  /** API Key 人工辨认前缀。 */
  prefix: string
  /** 已授权的公共能力。 */
  scopes: ApiKeyScope[]
}
