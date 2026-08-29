import { createBackupApplicationService, handleBackupFatalError, requireBackupDirectory } from './backup-support'

/**
 * 对指定备份执行不修改任何数据的完整验证。
 * @returns 验证完成时结束。
 */
async function main(): Promise<void> {
  const directory = requireBackupDirectory('pnpm restore:validate -- <备份目录>')
  const result = await createBackupApplicationService().validate(directory)
  console.log(`备份验证通过：${result.manifest.backupId}，${result.fileCount} 个文件，共 ${result.totalBytes} 字节。`)
}

void main().catch(handleBackupFatalError)
