import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { ImageAssetError } from '../../domain/generation/ImageAssetError'
import type { ImageAssetStorage, StoredImageAsset } from '../../ports/ImageAssetStorage'
import type { StorageCapacityGuard } from '../../ports/StorageCapacity'
import { StorageCapacityError } from '../../ports/StorageCapacity'
import { NodeStorageCapacityGuard } from '../system/NodeStorageCapacityGuard'

/** 单张本地图片最大 10 MiB。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** 运行和文件标识必须是规范 UUID，防止进入路径语义。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** 对外相对路径的严格格式。 */
const RELATIVE_ASSET_PATTERN = /^assets\/([0-9a-f-]{36})\.(png|jpg|webp)$/i

/** 在受控 artifacts 目录中保存经魔数校验的图片。 */
export class LocalImageAssetStorage implements ImageAssetStorage {
  /** 绝对资产根目录。 */
  private readonly artifactsDirectory: string

  /** @param dataDirectory 应用数据目录。 @param capacity 文件写入前的磁盘余量门禁。 */
  constructor(
    dataDirectory: string,
    private readonly capacity: StorageCapacityGuard = new NodeStorageCapacityGuard(),
  ) {
    this.artifactsDirectory = resolve(isAbsolute(dataDirectory) ? dataDirectory : resolve(process.cwd(), dataDirectory), 'artifacts')
  }

  /**
   * 校验大小、魔数和声明类型后原子保存图片。
   * @param runId 运行 UUID。
   * @param fileId 资产 UUID。
   * @param bytes 图片字节。
   * @param declaredMediaType 供应商声明类型。
   * @returns 本地资产描述。
   */
  async saveImage(runId: string, fileId: string, bytes: Uint8Array, declaredMediaType: string | null): Promise<StoredImageAsset> {
    assertIdentifier(runId)
    assertIdentifier(fileId)
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '图片文件为空或超过 10 MiB')
    }
    const detected = detectImageType(bytes)
    if (!detected) throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '图片文件类型不受支持或文件头无效')
    const declared = normalizeMediaType(declaredMediaType)
    if (declared && declared !== detected.mediaType) {
      throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '图片声明类型与文件内容不一致')
    }

    const runDirectory = this.resolveRunDirectory(runId)
    const assetsDirectory = resolve(runDirectory, 'assets')
    await mkdir(assetsDirectory, { recursive: true })
    const relativePath = `assets/${fileId}.${detected.extension}`
    const target = resolve(runDirectory, relativePath)
    const temporary = resolve(assetsDirectory, `.${fileId}.${randomUUID()}.tmp`)
    try {
      await this.capacity.assertCanWrite(assetsDirectory, bytes.byteLength)
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, target)
    }
    catch (error: unknown) {
      await rm(temporary, { force: true })
      if (isNoSpaceError(error)) throw new StorageCapacityError()
      throw error
    }
    return {
      relativePath,
      mediaType: detected.mediaType,
      sizeBytes: bytes.byteLength,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    }
  }

  /** @param runId 运行 UUID。 @param relativePath 严格资产相对路径。 @returns 文件字节。 */
  async readImage(runId: string, relativePath: string): Promise<Uint8Array> {
    assertIdentifier(runId)
    if (!RELATIVE_ASSET_PATTERN.test(relativePath)) throw new ImageAssetError('ASSET_PATH_INVALID', '图片资产路径无效')
    const runDirectory = this.resolveRunDirectory(runId)
    const target = resolve(runDirectory, relativePath)
    if (!target.startsWith(`${runDirectory}${sep}`)) throw new ImageAssetError('ASSET_PATH_INVALID', '图片资产路径越界')
    try {
      return new Uint8Array(await readFile(target))
    }
    catch {
      throw new ImageAssetError('ASSET_NOT_FOUND', '图片资产文件不存在')
    }
  }

  /** @param runId 运行 UUID。 @param relativePath 严格资产相对路径。 @returns 删除完成时结束。 */
  async deleteImage(runId: string, relativePath: string): Promise<void> {
    assertIdentifier(runId)
    if (!RELATIVE_ASSET_PATTERN.test(relativePath)) throw new ImageAssetError('ASSET_PATH_INVALID', '图片资产路径无效')
    const runDirectory = this.resolveRunDirectory(runId)
    const target = resolve(runDirectory, relativePath)
    if (!target.startsWith(`${runDirectory}${sep}`)) throw new ImageAssetError('ASSET_PATH_INVALID', '图片资产路径越界')
    await rm(target, { force: true })
  }

  /** @param runIds 明确的运行 UUID。 @returns 删除对应受控目录后结束。 */
  async deleteRunAssets(runIds: string[]): Promise<void> {
    for (const runId of runIds) {
      assertIdentifier(runId)
      await rm(this.resolveRunDirectory(runId), { recursive: true, force: true })
    }
  }

  /** @param runId 运行 UUID。 @returns 保证位于资产根下的运行目录。 */
  private resolveRunDirectory(runId: string): string {
    assertIdentifier(runId)
    return resolve(this.artifactsDirectory, runId)
  }
}

/** @param error 未知文件系统错误。 @returns 是否为操作系统磁盘空间不足。 */
function isNoSpaceError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOSPC'
}

/** @param value 待验证标识。 @returns 标识合法时无返回值。 */
function assertIdentifier(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new ImageAssetError('ASSET_PATH_INVALID', '图片资产标识无效')
}

/** @param bytes 文件字节。 @returns 可信媒体类型和扩展名；无法识别时返回 null。 */
function detectImageType(bytes: Uint8Array): { mediaType: StoredImageAsset['mediaType'], extension: 'png' | 'jpg' | 'webp' } | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return { mediaType: 'image/png', extension: 'png' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return { mediaType: 'image/jpeg', extension: 'jpg' }
  }
  if (bytes.length >= 12
    && new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP') {
    return { mediaType: 'image/webp', extension: 'webp' }
  }
  return null
}

/** @param value 供应商声明类型。 @returns 受支持的规范媒体类型或 null。 */
function normalizeMediaType(value: string | null): StoredImageAsset['mediaType'] | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'image/jpg') return 'image/jpeg'
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') return normalized
  throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '图片响应声明了不受支持的媒体类型')
}
