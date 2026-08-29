import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { getMethod, getRequestURL, getResponseStatus, setResponseHeader } from 'h3'
import type { NitroApp } from 'nitropack/types'
import { LocalStructuredLogger } from '../infrastructure/logging/LocalStructuredLogger'

/** 单个请求只保存在内存中的日志关联信息。 */
interface RequestLogContext {
  /** 服务端生成的请求标识。 */
  requestId: string
  /** 高精度开始时间。 */
  startedAt: bigint
}

/**
 * 为生产请求注册不记录正文和凭据的本地结构化日志。
 * @param nitroApp 当前 Nitro 应用实例。
 * @returns 日志钩子注册完成时结束。
 */
function initializeRequestLogging(nitroApp: NitroApp): void {
  const config = useRuntimeConfig()
  const logger = new LocalStructuredLogger({
    dataDirectory: config.dataDirectory,
    maximumFileBytes: Number(config.logging.maximumFileBytes),
    retentionDays: Number(config.logging.retentionDays),
  })
  const contexts = new WeakMap<H3Event, RequestLogContext>()

  /** @param event 当前请求。 @returns 添加请求标识后结束。 */
  function startRequest(event: H3Event): void {
    const requestId = randomUUID()
    contexts.set(event, { requestId, startedAt: process.hrtime.bigint() })
    setResponseHeader(event, 'x-request-id', requestId)
  }

  /** @param event 已完成请求。 @returns 安全请求摘要写盘后结束。 */
  async function finishRequest(event: H3Event): Promise<void> {
    const context = contexts.get(event)
    if (!context) return
    const durationMs = Number(process.hrtime.bigint() - context.startedAt) / 1_000_000
    await logger.write({
      level: getResponseStatus(event) >= 500 ? 'error' : 'info',
      event: 'http_request_completed',
      requestId: context.requestId,
      method: getMethod(event),
      path: getRequestURL(event).pathname,
      statusCode: getResponseStatus(event),
      durationMs: Math.round(durationMs * 100) / 100,
    })
  }

  /** @param error 未处理异常。 @param context Nitro 捕获上下文。 @returns 脱敏异常分类写盘后结束。 */
  async function recordUnhandledError(error: Error, context: { event?: H3Event }): Promise<void> {
    const request = context.event ? contexts.get(context.event) : undefined
    await logger.write({
      level: 'error',
      event: 'unhandled_server_error',
      requestId: request?.requestId ?? null,
      errorName: error.name,
    })
  }

  nitroApp.hooks.hook('request', startRequest)
  nitroApp.hooks.hook('afterResponse', finishRequest)
  nitroApp.hooks.hook('error', recordUnhandledError)
  nitroApp.hooks.hook('close', async () => await logger.close())
}

export default defineNitroPlugin(initializeRequestLogging)
