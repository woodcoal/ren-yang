/**
 * 从统一 API 错误响应或网络异常中提取可展示消息。
 * @param error 捕获到的未知异常。
 * @param fallback 无法识别结构时使用的默认消息。
 * @returns 不包含内部堆栈的用户消息。
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!isRecord(error)) {
    return fallback
  }

  const responseData = isRecord(error.data) ? error.data : null
  const responseError = responseData && isRecord(responseData.error) ? responseData.error : null
  return responseError && typeof responseError.message === 'string'
    ? responseError.message
    : fallback
}

/**
 * 判断未知值是否为可安全读取字段的普通对象。
 * @param value 待判断的未知值。
 * @returns 非 null 对象返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
