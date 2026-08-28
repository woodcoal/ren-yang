import type { Administrator } from '../domain/authentication/Administrator'

/** 创建唯一管理员所需的持久化字段。 */
export interface CreateAdministratorRecord {
  /** 固定管理员标识。 */
  id: string
  /** 管理员用户名。 */
  username: string
  /** 已完成安全哈希的密码。 */
  passwordHash: string
  /** 初始凭据版本。 */
  credentialVersion: number
  /** 创建和更新时间。 */
  timestamp: number
}

/** 管理员数据访问端口。 */
export interface AdministratorRepository {
  /**
   * 判断唯一管理员是否已存在。
   * @returns 已存在时返回 true，否则返回 false。
   */
  exists(): Promise<boolean>

  /**
   * 按用户名读取管理员。
   * @param username 已规范化的管理员用户名。
   * @returns 找到时返回管理员，否则返回 null。
   */
  findByUsername(username: string): Promise<Administrator | null>

  /**
   * 按固定标识读取管理员。
   * @param id 管理员固定标识。
   * @returns 找到时返回管理员，否则返回 null。
   */
  findById(id: string): Promise<Administrator | null>

  /**
   * 以数据库唯一约束保证只创建一名管理员。
   * @param record 已完成校验和密码哈希的数据。
   * @returns 本次成功创建时返回 true，管理员已存在时返回 false。
   */
  createIfAbsent(record: CreateAdministratorRecord): Promise<boolean>

  /**
   * 更新密码并递增凭据版本，使所有旧会话失效。
   * @param id 管理员固定标识。
   * @param passwordHash 新密码哈希。
   * @param timestamp 更新时间。
   * @returns 更新后的管理员；管理员不存在时返回 null。
   */
  updatePassword(id: string, passwordHash: string, timestamp: number): Promise<Administrator | null>
}
