import type { BackupPort } from '../../ports/BackupPort'
import type { BackupRestoreResult, BackupSummary, BackupValidationResult } from '../../../shared/types/backup'

/** 手工备份、验证和停机恢复应用服务。 */
export class BackupApplicationService {
  /** @param backup 受控备份基础设施端口。 */
  constructor(private readonly backup: BackupPort) {}

  /** @returns 新备份目录绝对路径。 */
  async create(): Promise<string> {
    return await this.backup.create()
  }

  /** @returns 不包含服务器绝对路径的新备份摘要。 */
  async createSummary(): Promise<BackupSummary> {
    const directory = await this.backup.create()
    const validation = await this.backup.validate(directory)
    return {
      backupId: validation.manifest.backupId,
      createdAt: validation.manifest.createdAt,
      fileCount: validation.fileCount,
      totalBytes: validation.totalBytes,
    }
  }

  /** @param backupDirectory 备份目录。 @returns 只读验证结果。 */
  async validate(backupDirectory: string): Promise<BackupValidationResult> {
    return await this.backup.validate(backupDirectory)
  }

  /** @param backupDirectory 已验证备份目录。 @returns 恢复结果。 */
  async restore(backupDirectory: string): Promise<BackupRestoreResult> {
    return await this.backup.restore(backupDirectory)
  }
}
