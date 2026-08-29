import { createBackupApplicationService, handleBackupFatalError, requireBackupDirectory } from './backup-support'

/**
 * 在应用停机后原子恢复指定备份，并永久保留恢复前目录。
 * @returns 恢复完成时结束。
 */
async function main(): Promise<void> {
  const directory = requireBackupDirectory('pnpm restore -- <备份目录>')
  const result = await createBackupApplicationService().restore(directory)
  console.log(`备份恢复完成：${result.backupId}`)
  console.log(`恢复前数据保留于：${result.rollbackDirectory}`)
}

void main().catch(handleBackupFatalError)
