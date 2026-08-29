import { statfs } from 'node:fs/promises'
import type { StorageCapacityGuard } from '../../ports/StorageCapacity'
import { StorageCapacityError } from '../../ports/StorageCapacity'

/** 默认要求每次写入后至少保留 100 MiB。 */
export const DEFAULT_MINIMUM_FREE_DISK_BYTES = 100 * 1024 * 1024

/** 使用操作系统文件系统统计实现磁盘余量门禁。 */
export class NodeStorageCapacityGuard implements StorageCapacityGuard {
  /**
   * 创建磁盘余量门禁。
   * @param minimumFreeBytes 每次成功写入后必须保留的最小字节数。
   */
  constructor(private readonly minimumFreeBytes = DEFAULT_MINIMUM_FREE_DISK_BYTES) {
    if (!Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) {
      throw new Error('最小磁盘保留字节数必须是非负安全整数')
    }
  }

  /**
   * 查询目录所在文件系统，并在余量不足时阻止写入。
   * @param directory 已存在的目标目录。
   * @param requiredBytes 本次最多写入字节数。
   * @returns 磁盘容量满足要求时结束。
   */
  async assertCanWrite(directory: string, requiredBytes: number): Promise<void> {
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new Error('待写入字节数必须是非负安全整数')
    const information = await statfs(directory, { bigint: true })
    const availableBytes = information.bavail * information.bsize
    const requiredTotal = BigInt(requiredBytes) + BigInt(this.minimumFreeBytes)
    if (availableBytes < requiredTotal) throw new StorageCapacityError()
  }
}
