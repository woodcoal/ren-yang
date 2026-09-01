import { describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { H3RequestSecurity } from '../../server/infrastructure/authentication/H3RequestSecurity'
import { parseBearerApiKey } from '../../server/infrastructure/authentication/ApiKeyBearerAuthentication'
import { isBrowserRequestOriginAllowed } from '../../server/infrastructure/http/RequestOriginValidator'
import { requiresBoundedRequestBody } from '../../server/infrastructure/http/RequestBodyLimitPolicy'

describe('HTTP 来源安全', () => {
  it('公共 API 只接受标准 Bearer 请求头中的非空 API Key', () => {
    expect(parseBearerApiKey('Bearer ry_v2_secret')).toBe('ry_v2_secret')
    expect(parseBearerApiKey('bearer ry_v2_secret')).toBe('ry_v2_secret')
    expect(parseBearerApiKey(undefined)).toBeNull()
    expect(parseBearerApiKey('Basic credential')).toBeNull()
    expect(parseBearerApiKey('Bearer')).toBeNull()
    expect(parseBearerApiKey('Bearer key extra')).toBeNull()
  })

  it('网页内部与公共 API 写请求共用实际字节上限', () => {
    expect(requiresBoundedRequestBody('/api/v1/personas', 'POST')).toBe(true)
    expect(requiresBoundedRequestBody('/api/v2/sources/files', 'POST')).toBe(true)
    expect(requiresBoundedRequestBody('/api/v2/openapi.json', 'GET')).toBe(false)
    expect(requiresBoundedRequestBody('/api/v2/docs', 'GET')).toBe(false)
    expect(requiresBoundedRequestBody('/unrelated', 'POST')).toBe(false)
  })

  it('同源浏览器请求和无来源头的维护脚本可以执行修改', () => {
    expect(isBrowserRequestOriginAllowed('https://ren-yang.example', 'same-origin', 'https://ren-yang.example')).toBe(true)
    expect(isBrowserRequestOriginAllowed(undefined, undefined, 'http://127.0.0.1:3000')).toBe(true)
  })

  it('跨站、畸形 Origin 和 cross-site Fetch Metadata 均被拒绝', () => {
    expect(isBrowserRequestOriginAllowed('https://attacker.example', 'cross-site', 'https://ren-yang.example')).toBe(false)
    expect(isBrowserRequestOriginAllowed('不是 URL', 'same-origin', 'https://ren-yang.example')).toBe(false)
    expect(isBrowserRequestOriginAllowed(undefined, 'cross-site', 'https://ren-yang.example')).toBe(false)
  })

  it('首次设置只接受直接连接和代理转发地址都属于回环的请求', () => {
    expect(new H3RequestSecurity(createEvent('127.0.0.1', {})).isLoopbackRequest()).toBe(true)
    expect(new H3RequestSecurity(createEvent(undefined, { 'x-forwarded-for': '127.0.0.1' })).isLoopbackRequest()).toBe(true)
    expect(new H3RequestSecurity(createEvent('127.0.0.1', { 'x-forwarded-for': '203.0.113.8' })).isLoopbackRequest()).toBe(false)
    expect(new H3RequestSecurity(createEvent(undefined, { 'x-forwarded-for': '127.0.0.1, 203.0.113.8' })).isLoopbackRequest()).toBe(false)
    expect(new H3RequestSecurity(createEvent('203.0.113.8', { 'x-forwarded-for': '127.0.0.1' })).isLoopbackRequest()).toBe(false)
  })
})

/**
 * 创建请求来源适配器需要的最小 H3 测试事件。
 * @param remoteAddress 直接套接字地址。
 * @param headers 转发来源请求头。
 * @returns 只包含来源字段的 H3 事件。
 */
function createEvent(remoteAddress: string | undefined, headers: Record<string, string>): H3Event {
  return {
    node: { req: { socket: { remoteAddress }, headers } },
  } as unknown as H3Event
}
