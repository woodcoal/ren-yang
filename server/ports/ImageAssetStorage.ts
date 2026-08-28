/** 已校验并保存的本地图片资产。 */
export interface StoredImageAsset {
  /** 相对于运行目录的安全资源路径。 */
  relativePath: string
  /** 从文件魔数识别的媒体类型。 */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  /** 文件字节数。 */
  sizeBytes: number
  /** 文件 SHA-256。 */
  contentHash: string
}

/** 本地图片资产存储端口。 */
export interface ImageAssetStorage {
  /**
   * 校验并原子保存图片。
   * @param runId 运行 UUID。
   * @param fileId 资产 UUID。
   * @param bytes 供应商图片字节。
   * @param declaredMediaType 供应商声明媒体类型，仅用于交叉校验。
   * @returns 可信本地资产描述。
   */
  saveImage(runId: string, fileId: string, bytes: Uint8Array, declaredMediaType: string | null): Promise<StoredImageAsset>

  /** @param runId 运行 UUID。 @param relativePath 已保存相对路径。 @returns 本地资产字节。 */
  readImage(runId: string, relativePath: string): Promise<Uint8Array>

  /** @param runId 运行 UUID。 @param relativePath 已保存相对路径。 @returns 删除单个资产后结束。 */
  deleteImage(runId: string, relativePath: string): Promise<void>

  /** @param runIds 明确的人物私有运行 UUID。 @returns 删除完成时结束。 */
  deleteRunAssets(runIds: string[]): Promise<void>
}
