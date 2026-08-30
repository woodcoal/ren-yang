import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 读取全部固定 AI 提示词及其草稿和发布历史。
 * @param event 当前管理员请求。
 * @returns 提示词管理工作区列表。
 */
async function handleListAiPrompts(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.aiPrompts.listWorkspaces())
}

export default defineEventHandler(handleListAiPrompts)
