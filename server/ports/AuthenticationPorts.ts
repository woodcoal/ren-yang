/** 会话中保存的最小管理员身份。 */
export interface AdministratorSessionPrincipal {
  /** 固定管理员标识。 */
  id: string
  /** 管理员用户名。 */
  username: string
  /** 创建会话时的凭据版本。 */
  credentialVersion: number
}

/** 密码哈希能力端口。 */
export interface PasswordHasher {
  /**
   * 对明文密码执行不可逆哈希。
   * @param plainPassword 已通过长度校验的明文密码。
   * @returns 可持久化的密码哈希。
   */
  hash(plainPassword: string): Promise<string>

  /**
   * 验证明文密码是否匹配已有哈希。
   * @param passwordHash 数据库中的密码哈希。
   * @param plainPassword 本次输入的明文密码。
   * @returns 匹配时返回 true，否则返回 false。
   */
  verify(passwordHash: string, plainPassword: string): Promise<boolean>
}

/** 当前 HTTP 请求的认证会话端口。 */
export interface AuthenticationSession {
  /**
   * 读取当前请求中的管理员身份。
   * @returns 有会话时返回身份，否则返回 null。
   */
  getPrincipal(): Promise<AdministratorSessionPrincipal | null>

  /**
   * 建立或替换当前管理员会话。
   * @param principal 允许写入加密 Cookie 的最小身份。
   * @returns 无返回值。
   */
  setPrincipal(principal: AdministratorSessionPrincipal): Promise<void>

  /**
   * 清除当前请求对应的会话 Cookie。
   * @returns 无返回值。
   */
  clear(): Promise<void>
}

/** 首次设置请求的来源安全端口。 */
export interface RequestSecurity {
  /**
   * 判断请求是否直接来自本机回环地址。
   * @returns 仅本机回环请求返回 true。
   */
  isLoopbackRequest(): boolean
}
