import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { SourceFileStorage } from '../../ports/SourceContentPorts'
import type { StorageCapacityGuard } from '../../ports/StorageCapacity'
import { StorageCapacityError } from '../../ports/StorageCapacity'
import { NodeStorageCapacityGuard } from '../system/NodeStorageCapacityGuard'

/** 把已验证的资料文件限制保存在数据目录 sources 子目录。 */
export class LocalSourceFileStorage implements SourceFileStorage {
  /** 资料目录绝对路径。 */
  private readonly sourceDirectory: string

  /**
   * 创建本地资料存储。
   * @param dataDirectory 应用数据目录绝对或相对路径。
   * @param capacity 文件写入前的磁盘余量门禁。
   */
  constructor(
    dataDirectory: string,
    private readonly capacity: StorageCapacityGuard = new NodeStorageCapacityGuard(),
  ) {
    this.sourceDirectory = resolve(process.cwd(), dataDirectory, 'sources')
  }

  /**
   * 以 UUID 文件名保存已验证字节，禁止覆盖既有文件。
   * @param sourceId 资料 UUID。
   * @param extension 已验证扩展名。
   * @param bytes 原始文件字节。
   * @returns 相对数据目录的 POSIX 路径。
   */
  async save(sourceId: string, extension: '.txt' | '.md', bytes: Uint8Array): Promise<string> {
    await mkdir(this.sourceDirectory, { recursive: true })
    const fileName = `${sourceId}${extension}`
    await this.capacity.assertCanWrite(this.sourceDirectory, bytes.byteLength)
    try {
      await writeFile(resolve(this.sourceDirectory, fileName), bytes, { flag: 'wx' })
    }
    catch (error: unknown) {
      if (isNoSpaceError(error)) throw new StorageCapacityError()
      throw error
    }
    return `sources/${fileName}`
  }

  /**
   * 删除本系统生成的 UUID 资料文件，不接受任意相对路径。
   * @param relativePath 数据库中保存的受控相对路径。
   * @returns 删除完成时结束；文件不存在也视为成功。
   * @throws Error 路径不符合本系统生成规则时抛出。
   */
  async delete(relativePath: string): Promise<void> {
    if (!/^sources\/[0-9a-f-]{36}\.(txt|md)$/.test(relativePath)) {
      throw new Error('拒绝删除不受控的资料文件路径')
    }
    const absolutePath = resolve(this.sourceDirectory, relativePath.slice('sources/'.length))
    if (!absolutePath.startsWith(`${this.sourceDirectory}${sep}`)) {
      throw new Error('资料文件路径越过数据目录')
    }
    await rm(absolutePath, { force: true })
  }
}

/** @param error 未知文件系统错误。 @returns 是否为操作系统磁盘空间不足。 */
function isNoSpaceError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOSPC'
}
