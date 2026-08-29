import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { reindexContextSchema } from '#shared/schemas/context'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 从 SQLite 全量重建外部索引的逐项结果。 */
async function handleReindexContext(event: H3Event) {
  return await executeController(event, async () => {
    reindexContextSchema.parse(await readBody(event))
    return await event.context.applicationServices.contextSynchronization.reindex()
  })
}

export default defineEventHandler(handleReindexContext)
