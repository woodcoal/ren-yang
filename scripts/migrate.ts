import { resolve } from 'node:path'
import { SqliteDatabase } from '../server/infrastructure/database/SqliteDatabase'

/**
 * 执行 SQLite 迁移并验证数据库完整性。
 * @returns 迁移与检查完成时结束。
 */
async function main(): Promise<void> {
  const database = new SqliteDatabase({
    dataDirectory: process.env.NUXT_DATA_DIRECTORY ?? './data',
    migrationsDirectory: resolve(process.cwd(), 'drizzle'),
  })

  try {
    const health = await database.check()
    if (!health.healthy) {
      throw new Error(`SQLite 健康检查失败：${health.integrity}`)
    }
    console.log(`SQLite 迁移完成：${health.databasePath}`)
  }
  finally {
    database.close()
  }
}

/**
 * 记录不包含密钥的命令行错误并设置失败退出码。
 * @param error 未处理的命令行错误。
 * @returns 无返回值。
 */
function handleFatalError(error: unknown): void {
  console.error(error instanceof Error ? error.message : 'SQLite 迁移发生未知错误')
  process.exitCode = 1
}

void main().catch(handleFatalError)
