import { Hash } from '@adonisjs/hash'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import type { PasswordHasher } from '../../ports/AuthenticationPorts'

/** 使用 nuxt-auth-utils 同源的 Scrypt 实现密码哈希端口。 */
export class ScryptPasswordHasher implements PasswordHasher {
  /** nuxt-auth-utils 默认使用的 AdonisJS Scrypt 实现。 */
  private readonly hasher = new Hash(new Scrypt())

  /**
   * 对明文密码执行带随机盐的 Scrypt 哈希。
   * @param plainPassword 已通过长度校验的明文密码。
   * @returns 可持久化且包含算法参数的密码哈希。
   */
  async hash(plainPassword: string): Promise<string> {
    return await this.hasher.make(plainPassword)
  }

  /**
   * 使用恒定时间的底层实现验证密码。
   * @param passwordHash 数据库中的 Scrypt 哈希。
   * @param plainPassword 本次登录输入的明文密码。
   * @returns 密码匹配时返回 true。
   */
  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    return await this.hasher.verify(passwordHash, plainPassword)
  }
}
