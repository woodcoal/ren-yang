/** 唯一管理员在领域层使用的持久化快照。 */
export interface Administrator {
  /** 固定管理员标识。 */
  id: string
  /** 管理员登录名称。 */
  username: string
  /** 不可逆密码哈希。 */
  passwordHash: string
  /** 密码修改或重置时递增，用于撤销旧会话。 */
  credentialVersion: number
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 最后更新时间，UTC Unix 毫秒。 */
  updatedAt: number
}

/** 唯一管理员使用的稳定主键。 */
export const ADMINISTRATOR_ID = 'administrator'
