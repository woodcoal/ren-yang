import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { LocalPersonaAvatarStorage } from '../../server/infrastructure/content/LocalPersonaAvatarStorage'

/** 测试人物 UUID。 */
const PERSONA_ID = '00000000-0000-4000-8000-000000000001'
/** 用于验证头像保持原始尺寸的 640×320 测试 PNG。 */
const PNG_BYTES = new Uint8Array(await sharp({
  create: { width: 640, height: 320, channels: 4, background: '#32658f' },
}).png().toBuffer())
/** 当前测试独占数据目录。 */
let directory: string | null = null

/**
 * 创建独占目录及本地头像存储。
 * @returns 指向测试目录的人物头像存储。
 */
function createStorage(): LocalPersonaAvatarStorage {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-avatar-storage-test-'))
  return new LocalPersonaAvatarStorage(directory)
}

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('LocalPersonaAvatarStorage', () => {
  it('原子保存、识别并替换人物头像', async () => {
    const storage = createStorage()
    await expect(storage.hasAvatar(PERSONA_ID)).resolves.toBe(false)

    const saved = await storage.saveAvatar(PERSONA_ID, PNG_BYTES, 'image/png')
    const metadata = await sharp(saved.bytes).metadata()
    expect(saved.mediaType).toBe('image/png')
    expect(metadata).toMatchObject({ width: 640, height: 320, format: 'png' })
    expect(saved.bytes).toEqual(PNG_BYTES)
    await expect(storage.hasAvatar(PERSONA_ID)).resolves.toBe(true)
    await expect(storage.readAvatar(PERSONA_ID)).resolves.toEqual(saved)
  })

  it('拒绝伪造类型、无效文件和非法人物路径', async () => {
    const storage = createStorage()
    await expect(storage.saveAvatar(PERSONA_ID, PNG_BYTES, 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_INVALID' })
    await expect(storage.saveAvatar(PERSONA_ID, new Uint8Array([1, 2, 3]), null)).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_INVALID' })
    await expect(storage.readAvatar('../outside')).rejects.toMatchObject({ code: 'ASSET_PATH_INVALID' })
  })

  it('只删除明确人物的头像目录', async () => {
    const storage = createStorage()
    await storage.saveAvatar(PERSONA_ID, PNG_BYTES, 'image/png')
    await storage.deleteAvatar(PERSONA_ID)

    expect(existsSync(resolve(directory!, 'avatars', PERSONA_ID))).toBe(false)
    await expect(storage.hasAvatar(PERSONA_ID)).resolves.toBe(false)
  })
})
