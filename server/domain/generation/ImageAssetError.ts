/** 本地图片资产校验或路径错误。 */
export class ImageAssetError extends Error {
  /**
   * 创建图片资产错误。
   * @param code 稳定错误码。
   * @param message 可安全展示的中文原因。
   */
  constructor(
    public readonly code: 'IMAGE_OUTPUT_INVALID' | 'ASSET_PATH_INVALID' | 'ASSET_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'ImageAssetError'
  }
}
