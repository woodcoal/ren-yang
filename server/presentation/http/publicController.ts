import type { H3Event } from 'h3'
import { getHeader, getMethod, getRequestURL, setResponseHeader, setResponseStatus } from 'h3'
import type { BinaryControllerResult } from './controller'
import { ZodError } from 'zod'
import { idempotencyKeySchema, type ApiKeyScope } from '../../../shared/schemas/publicApi'
import type { PublicApiJsonValue } from '../../ports/PublicApiRepository'
import { ApplicationError } from '../../application/errors/ApplicationError'

/** 公共 API 成功响应元数据。 */
export interface PublicApiMeta {
  /** 贯穿响应、日志和审计的请求追踪标识。 */
  requestId: string
  /** 写请求是否直接复用了首次成功结果。 */
  idempotencyReplayed?: boolean
}

/** 公共写控制器的稳定审计和响应选项。 */
export interface PublicWriteControllerOptions<TData extends PublicApiJsonValue> {
  /** 幂等摘要使用的已读取请求载荷。 */
  payload: unknown
  /** 审计中的目标资源类型。 */
  targetType: string
  /** 首次执行和幂等复用均返回的成功状态码。 */
  successStatusCode: number
  /** 从成功结果提取目标资源标识。 */
  targetId?: (data: TData) => string | null
  /** 在幂等创建结果持久化后等待或映射本次动态响应。 */
  resolveResponse?: (data: TData) => Promise<PublicWriteResolvedResponse>
}

/** 公共写接口完成幂等创建后生成的本次响应。 */
export interface PublicWriteResolvedResponse {
  /** 允许安全序列化的公共业务结果。 */
  data: PublicApiJsonValue
  /** 本次请求实际返回的成功状态码。 */
  statusCode: number
}

/** 公共 API 统一成功响应。 */
export interface PublicApiResponse<TData> {
  data: TData
  meta: PublicApiMeta
}

/**
 * 通过权限、持久幂等和脱敏审计执行公共写操作。
 * @param event 当前公共请求。
 * @param scope 接口要求的写权限。
 * @param options 请求载荷、目标类型、状态码和可选目标标识提取器。
 * @param action 只调用一个应用服务用例并返回 JSON 数据的动作。
 * @returns 带追踪和幂等元数据的统一响应。
 */
export async function executePublicWriteController<TData extends PublicApiJsonValue>(
  event: H3Event,
  scope: ApiKeyScope,
  options: PublicWriteControllerOptions<TData>,
  action: () => Promise<TData>,
): Promise<PublicApiResponse<PublicApiJsonValue> | PublicApiErrorResponse> {
  const principal = event.context.apiKeyPrincipal
  const method = getMethod(event).toUpperCase()
  const path = getRequestURL(event).pathname
  try {
    if (!principal) throw new ApplicationError('API_KEY_INVALID', 'API Key 无效、已过期或已吊销', 401)
    await event.context.applicationServices.apiKeys.requireScope(principal, scope)
    const idempotencyKey = idempotencyKeySchema.parse(getHeader(event, 'idempotency-key'))
    const result = await event.context.applicationServices.publicApi.executeIdempotent({
      apiKeyId: principal.id,
      method,
      path,
      idempotencyKey,
      payload: options.payload,
      action,
    })
    // 同步优先接口只把资源创建纳入幂等事务；等待异常后重试仍复用已创建资源，不会重复排队。
    const resolved = options.resolveResponse
      ? await options.resolveResponse(result.data)
      : { data: result.data, statusCode: options.successStatusCode }
    setResponseStatus(event, resolved.statusCode)
    await event.context.applicationServices.publicApi.recordAudit({
      apiKeyId: principal.id,
      requestId: requireRequestId(event),
      method,
      path,
      targetType: options.targetType,
      targetId: options.targetId?.(result.data) ?? null,
      result: 'succeeded',
      statusCode: resolved.statusCode,
      errorCode: null,
    })
    return {
      data: resolved.data,
      meta: { requestId: requireRequestId(event), idempotencyReplayed: result.replayed },
    }
  }
  catch (error: unknown) {
    if (principal) {
      try {
        await event.context.applicationServices.publicApi.recordAudit({
          apiKeyId: principal.id,
          requestId: requireRequestId(event),
          method,
          path,
          targetType: options.targetType,
          targetId: null,
          result: 'failed',
          statusCode: publicErrorStatus(error),
          errorCode: publicErrorCode(error),
        })
      }
      catch {
        console.error('公共 API 失败审计写入失败')
      }
    }
    return writePublicErrorResponse(event, error)
  }
}

/**
 * 记录 multipart 等写请求在进入幂等动作前发生的解析失败并返回统一错误。
 * @param event 当前已认证公共请求。
 * @param targetType 审计目标资源类型。
 * @param error 请求解析或校验错误。
 * @returns 统一公共错误响应。
 */
export async function writePublicPreflightError(
  event: H3Event,
  targetType: string,
  error: unknown,
): Promise<PublicApiErrorResponse> {
  const principal = event.context.apiKeyPrincipal
  if (principal) {
    try {
      await event.context.applicationServices.publicApi.recordAudit({
        apiKeyId: principal.id,
        requestId: requireRequestId(event),
        method: getMethod(event).toUpperCase(),
        path: getRequestURL(event).pathname,
        targetType,
        targetId: null,
        result: 'failed',
        statusCode: publicErrorStatus(error),
        errorCode: publicErrorCode(error),
      })
    }
    catch {
      console.error('公共 API 预处理失败审计写入失败')
    }
  }
  return writePublicErrorResponse(event, error)
}

/** 公共 API 统一错误响应。 */
export interface PublicApiErrorResponse {
  error: {
    code: string
    message: string
    requestId: string
    details?: Record<string, unknown>
  }
}

/**
 * 校验当前 API Key 权限后执行单一应用服务动作。
 * @param event 当前公共请求。
 * @param scope 接口要求的权限范围。
 * @param action 已完成边界解析的应用动作。
 * @returns 带请求追踪标识的统一响应。
 */
export async function executePublicController<TData>(
  event: H3Event,
  scope: ApiKeyScope,
  action: () => Promise<TData>,
): Promise<PublicApiResponse<TData> | PublicApiErrorResponse> {
  try {
    const principal = event.context.apiKeyPrincipal
    if (!principal) throw new ApplicationError('API_KEY_INVALID', 'API Key 无效、已过期或已吊销', 401)
    await event.context.applicationServices.apiKeys.requireScope(principal, scope)
    return { data: await action(), meta: { requestId: requireRequestId(event) } }
  }
  catch (error: unknown) {
    return writePublicErrorResponse(event, error)
  }
}

/**
 * 校验公共读取权限并返回受控二进制资产或导出文件。
 * @param event 当前公共请求。
 * @param scope 接口要求的读取权限。
 * @param action 只调用应用服务并返回已验证字节与媒体类型的动作。
 * @returns 文件字节或带请求追踪标识的统一错误响应。
 */
export async function executePublicBinaryController(
  event: H3Event,
  scope: ApiKeyScope,
  action: () => Promise<BinaryControllerResult>,
): Promise<Uint8Array | PublicApiErrorResponse> {
  try {
    const principal = event.context.apiKeyPrincipal
    if (!principal) throw new ApplicationError('API_KEY_INVALID', 'API Key 无效、已过期或已吊销', 401)
    await event.context.applicationServices.apiKeys.requireScope(principal, scope)
    const result = await action()
    setResponseHeader(event, 'content-type', result.mediaType)
    setResponseHeader(event, 'content-length', result.bytes.byteLength)
    setResponseHeader(event, 'x-content-type-options', 'nosniff')
    setResponseHeader(event, 'x-request-id', requireRequestId(event))
    if (result.fileName) setResponseHeader(event, 'content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`)
    return result.bytes
  }
  catch (error: unknown) {
    return writePublicErrorResponse(event, error)
  }
}

/**
 * 把应用错误和校验错误映射为公共 API 稳定错误契约。
 * @param event 当前公共请求。
 * @param error 捕获到的未知异常。
 * @returns 已设置状态码且包含请求追踪标识的错误响应。
 */
export function writePublicErrorResponse(event: H3Event, error: unknown): PublicApiErrorResponse {
  const requestId = requireRequestId(event)
  if (error instanceof ApplicationError) {
    const statusCode = error.statusCode === 400 ? 422 : error.statusCode
    setResponseStatus(event, statusCode)
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details ? { details: error.details } : {}),
      },
    }
  }
  if (error instanceof ZodError) {
    setResponseStatus(event, 422)
    return {
      error: {
        code: 'VALIDATION_FAILED',
        message: '请求参数校验失败',
        requestId,
        details: { issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) },
      },
    }
  }
  console.error('公共 API 发生未处理的服务器错误')
  setResponseStatus(event, 500)
  return { error: { code: 'INTERNAL_ERROR', message: '服务器发生未预期错误', requestId } }
}

/** @param event 当前请求。 @returns 插件生成的追踪标识。 */
function requireRequestId(event: H3Event): string {
  return event.context.requestId ?? 'request-id-unavailable'
}

/** @param error 公共控制器错误。 @returns 审计使用的稳定 HTTP 状态码。 */
function publicErrorStatus(error: unknown): number {
  if (error instanceof ApplicationError) return error.statusCode === 400 ? 422 : error.statusCode
  if (error instanceof ZodError) return 422
  return 500
}

/** @param error 公共控制器错误。 @returns 审计使用的稳定错误码。 */
function publicErrorCode(error: unknown): string {
  if (error instanceof ApplicationError) return error.code
  if (error instanceof ZodError) return 'VALIDATION_FAILED'
  return 'INTERNAL_ERROR'
}
