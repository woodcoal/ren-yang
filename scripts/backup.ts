import { createBackupApplicationService, handleBackupFatalError } from './backup-support'

/**
 * 在线创建 SQLite 与引用文件的一致性备份。
 * @returns 备份完成时结束。
 */
async function main(): Promise<void> {
  const directory = await createBackupApplicationService().create()
  console.log(`备份创建完成：${directory}`)
}

void main().catch(handleBackupFatalError)
