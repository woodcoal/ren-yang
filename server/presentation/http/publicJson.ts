import type { PublicApiJsonValue } from '../../ports/PublicApiRepository'

/** 公共响应中禁止输出的内部敏感字段。 */
const PRIVATE_FIELDS = new Set(['credentials', 'passwordCiphertext', 'keyDigest', 'secret'])

/**
 * 把应用服务结果转换为公共 JSON，并统一将时间戳输出为 ISO 8601 UTC。
 * @param value 应用服务返回的严格类型值。
 * @returns 不含内部敏感字段的公共 JSON。
 */
export function toPublicJson(value: unknown): PublicApiJsonValue {
  return mapValue(value, null)
}

/**
 * 递归脱敏并序列化单个公共响应值。
 * @param value 应用服务返回的当前未知值。
 * @param key 当前值所属字段名；根值和数组项为 null。
 * @returns 已过滤私有字段且转换时间的 JSON 值。
 * @remarks 不可序列化值会抛错，防止静默泄漏或契约漂移。
 */
function mapValue(value: unknown, key: string | null): PublicApiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (key?.endsWith('At')) return new Date(value).toISOString()
    if (!Number.isFinite(value)) throw new Error('公共响应包含无效数字')
    return value
  }
  if (Array.isArray(value)) return value.map(item => mapValue(item, null))
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([field, item]) => !PRIVATE_FIELDS.has(field) && item !== undefined)
      .map(([field, item]) => [field, mapValue(item, field)] as const)
    return Object.fromEntries(entries)
  }
  throw new Error('公共响应包含不能序列化的值')
}
