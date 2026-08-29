import { resolve } from 'node:path'
import { BackupApplicationService } from '../server/application/backup/BackupApplicationService'
import { LocalBackupManager } from '../server/infrastructure/backup/LocalBackupManager'

/**
 * 创建只供本机维护命令使用的备份应用服务。
 * @returns 使用当前数据目录和迁移版本的备份应用服务。
 */
export function createBackupApplicationService(): BackupApplicationService {
  return new BackupApplicationService(new LocalBackupManager(
    process.env.NUXT_DATA_DIRECTORY ?? './data',
    resolve(process.cwd(), 'drizzle'),
  ))
}

/**
 * 读取命令行中的唯一备份目录参数。
 * @param usage 缺少参数时显示的命令用法。
 * @returns 用户指定的备份目录。
 */
export function requireBackupDirectory(usage: string): string {
  const values = process.argv.slice(2).filter(value => value !== '--')
  if (values.length !== 1 || !values[0]) throw new Error(`必须指定一个备份目录。用法：${usage}`)
  return values[0]
}

/**
 * 输出不包含密钥的命令行错误并设置失败退出码。
 * @param error 未处理的命令行异常。
 * @returns 无返回值。
 */
export function handleBackupFatalError(error: unknown): void {
  console.error(error instanceof Error ? error.message : '备份维护命令发生未知错误')
  process.exitCode = 1
}
