import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { aiAlgorithmTestInputSchema } from '#shared/schemas/aiAlgorithmTest'
import { aiAlgorithmCodeSchema } from '#shared/schemas/aiConfiguration'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 真实调用当前配置测试一个固定算法，但不保存输入、结果或业务数据。
 * @param event 当前已认证管理员请求。
 * @returns 草稿优先的逐步算法诊断结果。
 */
async function handleTestAiAlgorithm(event: H3Event) {
  return await executeController(event, async () => {
    const code = aiAlgorithmCodeSchema.parse(getRouterParam(event, 'code'))
    const input = aiAlgorithmTestInputSchema.parse(await readBody(event))
    return await event.context.applicationServices.aiAlgorithmTesting.run(code, input)
  })
}

export default defineEventHandler(handleTestAiAlgorithm)
