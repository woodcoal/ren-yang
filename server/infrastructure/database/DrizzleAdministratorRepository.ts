import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Administrator } from '../../domain/authentication/Administrator'
import type {
  AdministratorPasswordUpdateSource,
  AdministratorRepository,
  CreateAdministratorRecord,
} from '../../ports/AdministratorRepository'
import type { ApplicationDatabase } from './SqliteDatabase'
import { administrators, auditEvents } from './schema'

/** 使用 Drizzle 和 SQLite 实现管理员数据访问端口。 */
export class DrizzleAdministratorRepository implements AdministratorRepository {
  /**
   * 创建管理员仓储。
   * @param db 已初始化并完成迁移的 Drizzle 数据库。
   */
  constructor(private readonly db: ApplicationDatabase) {}

  /**
   * 判断唯一管理员是否已存在。
   * @returns 已存在时返回 true。
   */
  async exists(): Promise<boolean> {
    const row = this.db.select({ id: administrators.id }).from(administrators).limit(1).get()
    return row !== undefined
  }

  /**
   * 按用户名读取管理员。
   * @param username 已规范化的用户名。
   * @returns 管理员记录或 null。
   */
  async findByUsername(username: string): Promise<Administrator | null> {
    return this.db.select().from(administrators).where(eq(administrators.username, username)).get() ?? null
  }

  /**
   * 按固定标识读取管理员。
   * @param id 管理员固定标识。
   * @returns 管理员记录或 null。
   */
  async findById(id: string): Promise<Administrator | null> {
    return this.db.select().from(administrators).where(eq(administrators.id, id)).get() ?? null
  }

  /**
   * 在唯一约束保护下创建管理员。
   * @param record 已校验并哈希的管理员数据。
   * @returns 成功插入时返回 true，冲突时返回 false。
   */
  async createIfAbsent(record: CreateAdministratorRecord): Promise<boolean> {
    return this.db.transaction((transaction) => {
      const result = transaction
        .insert(administrators)
        .values({
          id: record.id,
          username: record.username,
          passwordHash: record.passwordHash,
          credentialVersion: record.credentialVersion,
          createdAt: record.timestamp,
          updatedAt: record.timestamp,
        })
        .onConflictDoNothing()
        .run()
      if (result.changes === 1) {
        transaction.insert(auditEvents).values({
          id: randomUUID(), actor: 'system', action: 'administrator_created', targetType: 'administrator',
          targetId: record.id, detailsJson: '{}', createdAt: record.timestamp,
        }).run()
      }
      return result.changes === 1
    })
  }

  /**
   * 更新密码并原子递增凭据版本。
   * @param id 管理员固定标识。
   * @param passwordHash 新密码哈希。
   * @param timestamp 更新时间。
   * @param source 已登录管理员修改或本机维护重置。
   * @returns 更新后的管理员或 null。
   */
  async updatePassword(
    id: string,
    passwordHash: string,
    timestamp: number,
    source: AdministratorPasswordUpdateSource,
  ): Promise<Administrator | null> {
    return this.db.transaction((transaction) => {
      const administrator = transaction
        .update(administrators)
        .set({
          passwordHash,
          credentialVersion: sql`${administrators.credentialVersion} + 1`,
          updatedAt: timestamp,
        })
        .where(eq(administrators.id, id))
        .returning()
        .get() ?? null
      if (administrator) {
        transaction.insert(auditEvents).values({
          id: randomUUID(), actor: source,
          action: source === 'administrator' ? 'administrator_password_changed' : 'administrator_password_reset',
          targetType: 'administrator',
          targetId: id, detailsJson: '{}', createdAt: timestamp,
        }).run()
      }
      return administrator
    })
  }
}
