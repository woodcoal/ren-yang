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

/** 可只读验证的备份清单。 */
export interface BackupManifest {
  /** 当前唯一支持的清单版本。 */
  version: 1
  /** 备份稳定标识。 */
  backupId: string
  /** ISO 8601 创建时间。 */
  createdAt: string
  /** 已应用 Drizzle 迁移数量。 */
  migrationCount: number
  /** 数据库和全部引用文件。 */
  files: BackupManifestFile[]
}

/** 只读备份验证结果。 */
export interface BackupValidationResult {
  /** 已验证清单。 */
  manifest: BackupManifest
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
