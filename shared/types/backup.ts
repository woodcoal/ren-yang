/** 备份清单中的单个受控文件。 */
export interface BackupManifestFile {
  /** 相对备份根的 POSIX 路径。 */
  path: string
  /** 受控媒体类型。 */
  mediaType: string
  /** 文件字节数。 */
  sizeBytes: number
  /** 文件 SHA-256。 */
  sha256: string
}

/** 两代备份清单共用的不可变内容。 */
interface BackupManifestBase {
  /** 备份稳定标识。 */
  backupId: string
  /** ISO 8601 创建时间。 */
  createdAt: string
  /** 数据库和全部引用文件。 */
  files: BackupManifestFile[]
}

/** 压平迁移前生成的第一版备份清单。 */
export interface LegacyBackupManifest extends BackupManifestBase {
  /** 第一版清单使用迁移条数标识兼容性。 */
  version: 1
  /** 压平前已应用的 Drizzle 迁移数量。 */
  migrationCount: number
}

/** 当前可只读验证的备份清单。 */
export interface BackupManifest extends BackupManifestBase {
  /** 第二版清单使用稳定迁移版本时间。 */
  version: 2
  /** 当前数据库结构对应的 Drizzle 迁移版本时间。 */
  migrationVersion: number
}

/** 恢复流程允许读取的新旧备份清单。 */
export type CompatibleBackupManifest = BackupManifest | LegacyBackupManifest

/** 只读备份验证结果。 */
export interface BackupValidationResult {
  /** 已验证清单。 */
  manifest: CompatibleBackupManifest
  /** 文件总数。 */
  fileCount: number
  /** 文件总字节数。 */
  totalBytes: number
}

/** 实际恢复完成后的回退位置。 */
export interface BackupRestoreResult {
  /** 恢复来源备份标识。 */
  backupId: string
  /** 保留的恢复前数据目录。 */
  rollbackDirectory: string
}

/** 管理面板可见且不暴露服务器绝对路径的备份摘要。 */
export interface BackupSummary {
  /** 备份稳定标识。 */
  backupId: string
  /** ISO 8601 创建时间。 */
  createdAt: string
  /** 数据库与引用文件总数。 */
  fileCount: number
  /** 清单文件总字节数。 */
  totalBytes: number
}
