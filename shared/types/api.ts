/** API 成功响应的统一外层结构。 */
export interface ApiResponse<TData> {
  /** 当前请求返回的业务数据。 */
  data: TData
}

/** API 失败响应的统一外层结构。 */
export interface ApiErrorResponse {
  /** 可由界面安全展示和稳定判断的错误。 */
  error: {
    /** 稳定错误码。 */
    code: string
    /** 中文用户消息。 */
    message: string
    /** 不含敏感信息的可选详情。 */
    details?: Record<string, unknown>
  }
}

/** 对浏览器公开的管理员身份。 */
export interface AdministratorIdentity {
  /** 唯一管理员的固定标识。 */
  id: string
  /** 管理员登录名称。 */
  username: string
}

/** 当前登录状态。 */
export interface AuthenticationSessionResult {
  /** 当前请求是否拥有有效管理员会话。 */
  authenticated: boolean
  /** 已登录时返回管理员身份，未登录时返回 null。 */
  administrator: AdministratorIdentity | null
}

/** 首次设置状态。 */
export interface SetupStatusResult {
  /** true 表示数据库中尚无管理员，需要执行首次设置。 */
  setupRequired: boolean
}
