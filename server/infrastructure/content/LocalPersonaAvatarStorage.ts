import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ImageAssetError } from '../../domain/generation/ImageAssetError'
import type { PersonaAvatarFile, PersonaAvatarStorage } from '../../ports/PersonaAvatarStorage'
import type { StorageCapacityGuard } from '../../ports/StorageCapacity'
import { StorageCapacityError } from '../../ports/StorageCapacity'
import { NodeStorageCapacityGuard } from '../system/NodeStorageCapacityGuard'

/** 单张人物头像最大 10 MiB，兼容现有图片模型输出上限。 */
const MAX_AVATAR_BYTES = 10 * 1024 * 1024
/** 人物标识必须是规范 UUID，禁止用户输入进入路径语义。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** 每个人物目录内唯一且不带用户文件名的头像文件名。 */
const AVATAR_FILE_NAME = 'avatar'

/** 在受控 avatars 目录中保存人物头像。 */
export class LocalPersonaAvatarStorage implements PersonaAvatarStorage {
  /** 绝对头像根目录。 */
  private readonly avatarsDirectory: string

  /**
   * 创建本地人物头像存储。
   * @param dataDirectory 应用数据目录。
   * @param capacity 文件写入前的磁盘余量门禁。
   */
  constructor(
    dataDirectory: string,
    private readonly capacity: StorageCapacityGuard = new NodeStorageCapacityGuard(),
  ) {
    this.avatarsDirectory = resolve(isAbsolute(dataDirectory) ? dataDirectory : resolve(process.cwd(), dataDirectory), 'avatars')
  }

  /**
   * 判断人物是否已有头像。
   * @param personaId 人物 UUID。
   * @returns 头像文件存在且可识别时返回 true。
   */
  async hasAvatar(personaId: string): Promise<boolean> {
    const directory = this.resolvePersonaDirectory(personaId)
    try {
      await access(resolve(directory, AVATAR_FILE_NAME))
      return true
    }
    catch (error: unknown) {
      if (isFileNotFoundError(error)) return false
      throw error
    }
  }

  /**
   * 校验大小、魔数和声明类型后原子替换人物头像。
   * @param personaId 人物 UUID。
   * @param bytes 图片字节。
   * @param declaredMediaType 浏览器或图片模型声明的媒体类型。
   * @returns 保存后的可信头像文件。
   */
  async saveAvatar(personaId: string, bytes: Uint8Array, declaredMediaType: string | null): Promise<PersonaAvatarFile> {
    const directory = this.resolvePersonaDirectory(personaId)
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
      throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '头像文件为空或超过 10 MiB')
    }
    const mediaType = detectImageMediaType(bytes)
    if (!mediaType) throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '头像仅支持有效的 PNG、JPEG 或 WebP 图片')
    const declared = normalizeMediaType(declaredMediaType)
    if (declared && declared !== mediaType) {
      throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '头像声明类型与文件内容不一致')
    }

    await mkdir(directory, { recursive: true })
    const target = resolve(directory, AVATAR_FILE_NAME)
    const temporary = resolve(directory, `.${AVATAR_FILE_NAME}.${randomUUID()}.tmp`)
    try {
      await this.capacity.assertCanWrite(directory, bytes.byteLength)
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, target)
    }
    catch (error: unknown) {
      await rm(temporary, { force: true })
      if (isNoSpaceError(error)) throw new StorageCapacityError()
      throw error
    }
    return { bytes, mediaType }
  }

  /**
   * 读取并验证人物头像。
   * @param personaId 人物 UUID。
   * @returns 可信头像字节与媒体类型。
   */
  async readAvatar(personaId: string): Promise<PersonaAvatarFile> {
    const directory = this.resolvePersonaDirectory(personaId)
    const target = resolve(directory, AVATAR_FILE_NAME)
    if (!target.startsWith(`${directory}${sep}`)) throw new ImageAssetError('ASSET_PATH_INVALID', '头像文件路径越界')
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(target))
    }
    catch {
      throw new ImageAssetError('ASSET_NOT_FOUND', '人物头像不存在')
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
      throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '人物头像文件无效')
    }
    const mediaType = detectImageMediaType(bytes)
    if (!mediaType) throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '人物头像文件类型无效')
    return { bytes, mediaType }
  }

  /**
   * 删除明确人物的头像目录。
   * @param personaId 人物 UUID。
   * @returns 删除完成时结束。
   */
  async deleteAvatar(personaId: string): Promise<void> {
    await rm(this.resolvePersonaDirectory(personaId), { recursive: true, force: true })
  }

  /**
   * 解析人物头像目录并验证标识。
   * @param personaId 人物 UUID。
   * @returns 位于头像根目录内的绝对路径。
   */
  private resolvePersonaDirectory(personaId: string): string {
    assertIdentifier(personaId)
    return resolve(this.avatarsDirectory, personaId)
  }
}

/**
 * 判断底层文件系统异常是否表示磁盘空间不足。
 * @param error 未知文件系统异常。
 * @returns 错误码为 ENOSPC 时返回 true。
 */
function isNoSpaceError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOSPC'
}

/**
 * 判断底层文件系统异常是否表示文件不存在。
 * @param error 未知文件系统异常。
 * @returns 错误码为 ENOENT 时返回 true。
 */
function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * 验证进入目录名的人物标识。
 * @param value 待验证人物 UUID。
 * @returns 标识合法时无返回值。
 */
function assertIdentifier(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new ImageAssetError('ASSET_PATH_INVALID', '人物头像标识无效')
}

/**
 * 通过文件魔数识别受支持的图片媒体类型。
 * @param bytes 图片原始字节。
 * @returns 可信媒体类型；无法识别时返回 null。
 */
function detectImageMediaType(bytes: Uint8Array): PersonaAvatarFile['mediaType'] | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12
    && new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/**
 * 规范化浏览器或模型声明的图片媒体类型。
 * @param value 未可信的 Content-Type。
 * @returns 受支持的规范媒体类型；未声明时返回 null。
 */
function normalizeMediaType(value: string | null): PersonaAvatarFile['mediaType'] | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'image/jpg') return 'image/jpeg'
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') return normalized
  throw new ImageAssetError('IMAGE_OUTPUT_INVALID', '头像声明了不受支持的媒体类型')
}
