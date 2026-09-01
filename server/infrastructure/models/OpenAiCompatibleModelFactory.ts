import type { AiModelFactory, AiTextModelOptions } from '../../ports/AiModelFactory'
import type { TextModelPort } from '../../ports/TextModelPort'
import type { ImageModelPort } from '../../ports/ImageModelPort'
import { OpenAiCompatibleImageModel } from './OpenAiCompatibleImageModel'
import { OpenAiCompatibleTextModel } from './OpenAiCompatibleTextModel'

/** 为数据库配置的不同端点按需创建 OpenAI-compatible 模型适配器。 */
export class OpenAiCompatibleModelFactory implements AiModelFactory {
  /**
   * 创建文本模型，不缓存已解密凭据。
   * @param options 当前算法步骤的端点、临时明文凭据与模型标识。
   * @returns OpenAI-compatible 文本模型端口。
   */
  createTextModel(options: AiTextModelOptions): TextModelPort {
    return new OpenAiCompatibleTextModel(options)
  }

  /**
   * 创建图片模型，不缓存已解密凭据。
   * @param options 当前算法步骤的端点、临时明文凭据与模型标识。
   * @returns OpenAI-compatible 图片模型端口。
   */
  createImageModel(options: AiTextModelOptions): ImageModelPort {
    return new OpenAiCompatibleImageModel(options)
  }
}
