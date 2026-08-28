import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { LocalImageAssetStorage } from '../../server/infrastructure/content/LocalImageAssetStorage'

/** 测试运行 UUID。 */
const RUN_ID = '00000000-0000-4000-8000-000000000001'
/** 测试资产 UUID。 */
const ASSET_ID = '00000000-0000-4000-8000-000000000002'
/** 可识别的最小测试 PNG 字节。 */
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
/** 当前测试独占数据目录。 */
let directory: string | null = null

/** @returns 创建独占目录及本地图片存储。 */
function createStorage(): LocalImageAssetStorage {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-image-storage-test-'))
  return new LocalImageAssetStorage(directory)
}

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('LocalImageAssetStorage', () => {
  it('以魔数决定的安全扩展名原子保存并读取图片', async () => {
    const storage = createStorage()
    const stored = await storage.saveImage(RUN_ID, ASSET_ID, PNG_BYTES, 'image/png; charset=binary')

    expect(stored).toMatchObject({ relativePath: `assets/${ASSET_ID}.png`, mediaType: 'image/png', sizeBytes: PNG_BYTES.byteLength })
    expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/)
    await expect(storage.readImage(RUN_ID, stored.relativePath)).resolves.toEqual(PNG_BYTES)
  })

  it('拒绝声明类型与魔数冲突、未知类型和超限文件', async () => {
    const storage = createStorage()
    await expect(storage.saveImage(RUN_ID, ASSET_ID, PNG_BYTES, 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_INVALID' })
    await expect(storage.saveImage(RUN_ID, ASSET_ID, new Uint8Array([1, 2, 3]), null)).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_INVALID' })
    await expect(storage.saveImage(RUN_ID, ASSET_ID, new Uint8Array(10 * 1024 * 1024 + 1), null)).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_INVALID' })
  })

  it('拒绝路径越界并只删除明确运行目录', async () => {
    const storage = createStorage()
    const stored = await storage.saveImage(RUN_ID, ASSET_ID, PNG_BYTES, 'image/png')
    await expect(storage.readImage(RUN_ID, '../secret.png')).rejects.toMatchObject({ code: 'ASSET_PATH_INVALID' })

    await storage.deleteImage(RUN_ID, stored.relativePath)
    expect(existsSync(resolve(directory!, 'artifacts', RUN_ID, stored.relativePath))).toBe(false)
    const restored = await storage.saveImage(RUN_ID, ASSET_ID, PNG_BYTES, 'image/png')
    await storage.deleteRunAssets([RUN_ID])
    expect(existsSync(resolve(directory!, 'artifacts', RUN_ID, restored.relativePath))).toBe(false)
  })
})
