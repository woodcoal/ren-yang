import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { clearContextHistorySchema } from '#shared/schemas/history'
import { executeController } from '../../../presentation/http/controller'

/**
 * 清理成功、失败或已取消的外部上下文后台任务历史。
 * @param event 当前管理员请求，正文必须包含明确确认标记。
 * @returns 实际删除数量；活动同步任务和业务历史不受影响。
 */
async function handleClearContextHistory(event: H3Event) {
  return await executeController(event, async () => {
    clearContextHistorySchema.parse(await readBody(event))
    return await event.context.applicationServices.history.clearTerminalContextTasks()
  })
}

export default defineEventHandler(handleClearContextHistory)
