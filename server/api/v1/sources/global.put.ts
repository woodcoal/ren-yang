import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { replaceGlobalSourcesSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 原子替换当前 Account 的全局资料集合。
 * @param event 当前 H3 请求事件。
 * @returns 最终集合及新增、移除差异。
 */
async function handleReplaceGlobalSources(event: H3Event) {
  return await executeController(event, async () => {
    const input = replaceGlobalSourcesSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.replaceGlobalSources(input)
  })
}

export default defineEventHandler(handleReplaceGlobalSources)
