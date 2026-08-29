import { OpenAiCompatibleImageModel } from '../server/infrastructure/models/OpenAiCompatibleImageModel'
import { OpenAiCompatibleTextModel } from '../server/infrastructure/models/OpenAiCompatibleTextModel'

/** 真实模型验收前置检查的非敏感结果。 */
export interface RealModelAcceptancePreflightResult {
  /** 文本模型名称和接口来源。 */
  textModel: {
    model: string
    endpointOrigin: string
  }
  /** 图片模型名称和接口来源。 */
  imageModel: {
    model: string
    endpointOrigin: string
  }
}

/**
 * 校验真实模型验收所需的仓库外环境配置，不联网且不返回任何密钥。
 * @param environment 待检查的进程环境变量集合。
 * @returns 只包含模型名称和接口来源的安全摘要。
 * @throws Error 必填配置缺失、会话密钥过短或模型接口地址无效时抛出。
 */
export function validateRealModelAcceptanceEnvironment(
  environment: NodeJS.ProcessEnv,
): RealModelAcceptancePreflightResult {
  const sessionPassword = requireEnvironmentValue(environment, 'NUXT_SESSION_PASSWORD')
  if (sessionPassword.length < 32) throw new Error('NUXT_SESSION_PASSWORD 长度不能少于 32 个字符')

  const textModel = new OpenAiCompatibleTextModel({
    endpoint: requireEnvironmentValue(environment, 'NUXT_TEXT_MODEL_ENDPOINT'),
    apiKey: requireEnvironmentValue(environment, 'NUXT_TEXT_MODEL_API_KEY'),
    model: requireEnvironmentValue(environment, 'NUXT_TEXT_MODEL_MODEL'),
  }).getConfiguredModel()
  if (!textModel) throw new Error('文本模型配置无效；接口必须是 HTTP(S) API 根地址或完整 Chat Completions 地址')

  const imageModel = new OpenAiCompatibleImageModel({
    endpoint: requireEnvironmentValue(environment, 'NUXT_IMAGE_MODEL_ENDPOINT'),
    apiKey: requireEnvironmentValue(environment, 'NUXT_IMAGE_MODEL_API_KEY'),
    model: requireEnvironmentValue(environment, 'NUXT_IMAGE_MODEL_MODEL'),
  }).getConfiguredModel()
  if (!imageModel) throw new Error('图片模型配置无效；接口必须是 HTTP(S) API 根地址或完整 Images Generations 地址')

  return {
    textModel: { model: textModel.model, endpointOrigin: textModel.endpointOrigin },
    imageModel: { model: imageModel.model, endpointOrigin: imageModel.endpointOrigin },
  }
}

/**
 * 读取一个非空环境变量；错误只包含变量名，不输出变量值。
 * @param environment 进程环境变量集合。
 * @param name 必填环境变量名称。
 * @returns 去除首尾空白后的配置值。
 * @throws Error 配置缺失或只有空白字符时抛出。
 */
function requireEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} 未配置`)
  return value
}
