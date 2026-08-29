/** 磁盘余量不足时由存储容量端口抛出的稳定异常。 */
export class StorageCapacityError extends Error {
  /** @param message 可安全记录和展示的容量不足原因。 */
  constructor(message = '磁盘可用空间不足，已停止创建新文件') {
    super(message)
    this.name = 'StorageCapacityError'
  }
}

/** 文件存储写入前使用的容量门禁。 */
export interface StorageCapacityGuard {
  /**
   * 确认目标文件写入后仍保留最低磁盘余量。
   * @param directory 已存在的目标目录。
   * @param requiredBytes 本次最多需要写入的字节数。
   * @returns 空间足够时结束，否则抛出 StorageCapacityError。
   */
  assertCanWrite(directory: string, requiredBytes: number): Promise<void>
}
