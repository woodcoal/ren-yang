import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import { ZodError } from 'zod'
import type { ApiErrorResponse, ApiResponse } from '../../../shared/types/api'
import { ApplicationError } from '../../application/errors/ApplicationError'

/**
 * 执行一个控制器应用服务调用并统一映射成功和错误响应。
 * @param event 当前 H3 请求事件。
 * @param action 已完成请求解析、只调用应用服务的动作。
 * @returns 统一成功响应或稳定错误响应。
 */
export async function executeController<TData>(
  event: H3Event,
  action: () => Promise<TData>,
): Promise<ApiResponse<TData> | ApiErrorResponse> {
  try {
    return { data: await action() }
  }
  catch (error: unknown) {
    return writeErrorResponse(event, error)
  }
}

/**
 * 把应用错误、Zod 错误和未知错误转换为安全响应。
 * @param event 当前 H3 请求事件。
 * @param error 捕获到的未知错误。
 * @returns 已设置 HTTP 状态码的错误响应。
 */
export function writeErrorResponse(event: H3Event, error: unknown): ApiErrorResponse {
  if (error instanceof ApplicationError) {
    setResponseStatus(event, error.statusCode)
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    }
  }

  if (error instanceof ZodError) {
    setResponseStatus(event, 400)
    return {
      error: {
        code: 'VALIDATION_FAILED',
        message: '请求参数校验失败',
        details: {
          issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
        },
      },
    }
  }

  console.error('未处理的服务器错误', error)
  setResponseStatus(event, 500)
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务器发生未预期错误',
    },
  }
}
