import type { ImageModelSnapshot } from '../domain/generation/GenerationModels'

/** 图片模型生成请求。 */
export interface ImageModelRequest {
  /** 已由应用层构造、不包含隐藏凭据的视觉提示。 */
  prompt: string
  /** 规格确认时固定的宽高比。 */
  aspectRatio: '1:1' | '4:3' | '3:4' | '16:9' | '9:16'
  /** 单次网络调用超时毫秒数。 */
  timeoutMs: number
}

/** 图片模型归一化后的文件响应。 */
export interface ImageModelResponse {
  /** 图片原始字节；本地存储前仍需校验媒体魔数和大小。 */
  bytes: Uint8Array
  /** 供应商或下载响应声明的媒体类型。 */
  declaredMediaType: string | null
}

/** 与具体图片供应商隔离的模型端口。 */
export interface ImageModelPort {
  /** @returns 配置完整时的非敏感模型快照，否则返回 null。 */
  getConfiguredModel(): ImageModelSnapshot | null
  /** @param request 已解析视觉生成请求。 @returns 下载或解码后的图片字节。 */
  generate(request: ImageModelRequest): Promise<ImageModelResponse>
}

/** 可映射为稳定错误码的图片模型异常。 */
export class ImageModelError extends Error {
  /**
   * 创建图片模型异常。
   * @param code 稳定错误分类。
   * @param message 已脱敏中文原因。
   * @param retryable 是否允许有限自动重试。
   */
  constructor(
    public readonly code: 'CAPABILITY_DISABLED' | 'IMAGE_PROVIDER_TIMEOUT' | 'IMAGE_PROVIDER_RATE_LIMITED' | 'IMAGE_PROVIDER_UNAVAILABLE' | 'IMAGE_OUTPUT_INVALID' | 'IMAGE_DOWNLOAD_BLOCKED',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ImageModelError'
  }
}
