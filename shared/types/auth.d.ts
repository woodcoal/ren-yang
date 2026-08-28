declare module '#auth-utils' {
  interface User {
    /** 唯一管理员的固定标识。 */
    id: string
    /** 当前管理员用户名。 */
    username: string
    /** 用于使密码重置前会话失效的凭据版本。 */
    credentialVersion: number
  }
}

export {}
