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
   * @returns 直接连接来自本机时返回 true。
   */
  isLoopbackRequest(): boolean {
    const address = this.event.node.req.socket.remoteAddress
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }
}
