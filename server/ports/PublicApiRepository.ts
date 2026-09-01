/** 可稳定序列化并写入幂等结果的 JSON 值。 */
export type PublicApiJsonValue = null | boolean | number | string | PublicApiJsonValue[] | { [key: string]: PublicApiJsonValue }

/** 持久化的公共 API 幂等记录。 */
export interface PublicApiIdempotencyRecord {
  id: string
  apiKeyId: string
  method: string
  path: string
  idempotencyKey: string
  requestHash: string
  response: PublicApiJsonValue | null
  createdAt: number
  updatedAt: number
}

/** 不含凭据和业务正文的公共 API 审计记录。 */
export interface NewPublicApiAuditRecord {
  id: string
  apiKeyId: string
  requestId: string
  method: string
  path: string
  targetType: string
  targetId: string | null
  result: 'succeeded' | 'failed'
  statusCode: number
  errorCode: string | null
  createdAt: number
}

/** 公共 API 幂等与审计持久化端口。 */
export interface PublicApiRepository {
  /** @param apiKeyId Key 标识。 @param method HTTP 方法。 @param path 稳定路径。 @param idempotencyKey 调用方幂等键。 @returns 已有记录或 null。 */
  findIdempotency(apiKeyId: string, method: string, path: string, idempotencyKey: string): Promise<PublicApiIdempotencyRecord | null>
  /** @param record 尚未完成的首次请求记录。 @returns 成功占用时为 true。 */
  reserveIdempotency(record: PublicApiIdempotencyRecord): Promise<boolean>
  /** @param id 幂等记录标识。 @param response 成功结果。 @param timestamp 完成时间。 @returns 是否完成。 */
  completeIdempotency(id: string, response: PublicApiJsonValue, timestamp: number): Promise<boolean>
  /** @param id 失败动作对应的幂等记录。 @returns 删除完成时结束。 */
  releaseIdempotency(id: string): Promise<void>
  /** @param record 已脱敏公共写操作审计。 @returns 写入完成时结束。 */
  appendAudit(record: NewPublicApiAuditRecord): Promise<void>
}
