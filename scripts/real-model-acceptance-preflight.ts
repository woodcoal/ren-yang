import { validateRealModelAcceptanceEnvironment } from './real-model-acceptance-support'

/**
 * 执行离线前置检查并仅输出非敏感模型摘要。
 * @returns 检查完成时结束。
 */
async function main(): Promise<void> {
  const result = validateRealModelAcceptanceEnvironment(process.env)
  console.log('真实模型验收前置检查通过；本命令未发起任何模型请求。')
  console.log(`文本模型：${result.textModel.model} @ ${result.textModel.endpointOrigin}`)
  console.log(`图片模型：${result.imageModel.model} @ ${result.imageModel.endpointOrigin}`)
}

/**
 * 输出不包含配置值的失败原因并设置非零退出码。
 * @param error 未处理的前置检查异常。
 * @returns 无返回值。
 */
function handleFatalError(error: unknown): void {
  console.error(error instanceof Error ? error.message : '真实模型验收前置检查发生未知错误')
  process.exitCode = 1
}

void main().catch(handleFatalError)
