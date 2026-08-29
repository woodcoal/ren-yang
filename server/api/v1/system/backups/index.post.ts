import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 在线创建 SQLite 与不可变引用文件的一致性备份。
 * @param event 当前 H3 请求事件。
 * @returns 不包含服务器绝对路径的备份清单摘要。
 */
async function handleCreateBackup(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.backup.createSummary()
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreateBackup)
