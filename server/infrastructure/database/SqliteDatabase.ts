import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { DatabaseHealthReader, DatabaseHealthSnapshot } from '../../ports/DatabaseHealth'
import { databaseSchema } from './schema'

/** 初始化 SQLite 所需配置。 */
export interface SqliteDatabaseOptions {
  /** 运行时数据目录，可以是相对进程目录或绝对路径。 */
  dataDirectory: string
  /** Drizzle SQLite 迁移目录。 */
  migrationsDirectory: string
}

/** 应用内共享的 Drizzle 数据库类型。 */
export type ApplicationDatabase = BetterSQLite3Database<typeof databaseSchema>

/** 封装 SQLite 连接、运行设置、迁移和健康检查。 */
export class SqliteDatabase implements DatabaseHealthReader {
  /** Drizzle 数据访问入口。 */
  public readonly db: ApplicationDatabase

  /** SQLite 数据库文件绝对路径。 */
  public readonly databasePath: string

  /**
   * 打开 SQLite、创建数据目录、应用运行参数并执行迁移。
   * @param options 数据目录和迁移目录。
   */
  constructor(options: SqliteDatabaseOptions) {
    const dataDirectory = resolveFromProcess(options.dataDirectory)
    this.databasePath = resolve(dataDirectory, 'app.sqlite')
    createRuntimeDirectories(dataDirectory)

    this.client = new Database(this.databasePath)
    this.client.pragma('journal_mode = WAL')
    this.client.pragma('busy_timeout = 5000')
    this.db = drizzle(this.client, { schema: databaseSchema })
    this.client.pragma('foreign_keys = OFF')
    try {
      migrate(this.db, { migrationsFolder: resolveFromProcess(options.migrationsDirectory) })
    }
    finally {
      this.client.pragma('foreign_keys = ON')
    }
    const violations = this.client.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      this.client.close()
      throw new Error('数据库迁移后外键完整性检查失败')
    }
  }

  /** 原生 SQLite 客户端，仅供数据库适配器内部使用。 */
  private readonly client: BetterSqliteDatabase

  /**
   * 返回原生 SQLite 客户端供同一基础设施层的原子任务查询使用。
   * @returns 已设置外键、WAL 和超时参数的客户端。
   */
  getClient(): BetterSqliteDatabase {
    return this.client
  }

  /**
   * 检查数据库完整性和关键运行参数。
   * @returns SQLite 健康状态快照。
   */
  async check(): Promise<DatabaseHealthSnapshot> {
    const journalMode = readSinglePragmaValue(this.client.pragma('journal_mode'))
    const foreignKeys = Number(readSinglePragmaValue(this.client.pragma('foreign_keys')))
    const integrity = readSinglePragmaValue(this.client.pragma('integrity_check'))

    return {
      healthy: integrity === 'ok' && foreignKeys === 1 && journalMode.toLowerCase() === 'wal',
      databasePath: this.databasePath,
      journalMode,
      foreignKeysEnabled: foreignKeys === 1,
      integrity,
    }
  }

  /**
   * 安全关闭 SQLite 连接。
   * @returns 无返回值。
   */
  close(): void {
    if (this.client.open) {
      this.client.close()
    }
  }
}

/**
 * 把相对路径解析为基于当前工作目录的绝对路径。
 * @param pathValue 配置提供的相对或绝对路径。
 * @returns 规范化后的绝对路径。
 */
function resolveFromProcess(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue)
}

/**
 * 创建 MVP 约定的全部运行时子目录。
 * @param dataDirectory 运行时数据根目录绝对路径。
 * @returns 无返回值。
 */
function createRuntimeDirectories(dataDirectory: string): void {
  for (const directory of ['', 'sources', 'artifacts', 'exports', 'backups', 'logs']) {
    mkdirSync(resolve(dataDirectory, directory), { recursive: true })
  }
}

/**
 * 从 better-sqlite3 的 PRAGMA 数组返回第一行第一个值。
 * @param rows PRAGMA 查询结果。
 * @returns 字符串化后的值；没有结果时返回空字符串。
 */
function readSinglePragmaValue(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0] !== 'object' || rows[0] === null) {
    return ''
  }
  const value = Object.values(rows[0] as Record<string, unknown>)[0]
  return value === undefined || value === null ? '' : String(value)
}
