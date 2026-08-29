import type { BackupRestoreResult, BackupValidationResult } from '../../shared/types/backup'

/** 备份基础设施端口。 */
export interface BackupPort {
  /** @returns 新备份目录绝对路径。 */
  create(): Promise<string>
  /** @param backupDirectory 备份目录。 @returns 只读验证结果。 */
  validate(backupDirectory: string): Promise<BackupValidationResult>
  /** @param backupDirectory 已存在备份目录。 @returns 恢复结果和回退目录。 */
  restore(backupDirectory: string): Promise<BackupRestoreResult>
}
