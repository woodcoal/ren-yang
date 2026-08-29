import type { H3Event } from 'h3'
import type { RequestSecurity } from '../../ports/AuthenticationPorts'

/** 基于 Node 套接字地址判断首次设置是否来自本机。 */
export class H3RequestSecurity implements RequestSecurity {
  /**
   * 创建请求来源安全适配器。
   * @param event 当前 H3 请求事件。
   */
  constructor(private readonly event: H3Event) {}

  /**
   * 只接受 IPv4、IPv6 和 IPv4 映射 IPv6 的回环地址。
   * Nuxt 开发代理不保留套接字地址时，只信任其写入的完整回环转发链。
   * @returns 直接连接或开发代理转发均来自本机时返回 true。
   */
  isLoopbackRequest(): boolean {
    const address = this.event.node.req.socket.remoteAddress
    const forwarded = parseForwardedAddresses(this.event.node.req.headers['x-forwarded-for'])
    const realIp = parseForwardedAddresses(this.event.node.req.headers['x-real-ip'])
    const directLoopback = isLoopbackAddress(address)
    // 开发代理缺少 socket.remoteAddress 时，要求它提供的每个来源地址均为回环地址。
    const developmentProxyLoopback = address === undefined
      && forwarded.length > 0
      && forwarded.every(isLoopbackAddress)
    return (directLoopback || developmentProxyLoopback)
      && forwarded.every(isLoopbackAddress)
      && realIp.every(isLoopbackAddress)
  }
}

/** @param address IPv4、IPv6 或映射地址。 @returns 是否是严格回环地址。 */
function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 解析代理地址头中的完整转发链。
 * @param header X-Forwarded-For 或 X-Real-IP 原始请求头。
 * @returns 已去除空值的地址列表；请求头缺失时返回空数组。
 */
function parseForwardedAddresses(header: string | string[] | undefined): string[] {
  if (!header) return []
  return (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map(address => address.trim())
    .filter(Boolean)
}
