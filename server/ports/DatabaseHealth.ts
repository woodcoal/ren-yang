/** SQLite 健康状态读取端口。 */
export interface DatabaseHealthReader {
  /**
   * 执行只读数据库健康检查。
   * @returns 当前 SQLite 配置和完整性结果。
   */
  check(): Promise<DatabaseHealthSnapshot>
}

/** SQLite 健康状态快照。 */
export interface DatabaseHealthSnapshot {
  /** 数据库是否通过完整性和关键配置检查。 */
  healthy: boolean
  /** SQLite 数据库文件绝对路径。 */
  databasePath: string
  /** 当前日志模式。 */
  journalMode: string
  /** 外键约束是否启用。 */
  foreignKeysEnabled: boolean
  /** SQLite 完整性检查返回值。 */
  integrity: string
}
