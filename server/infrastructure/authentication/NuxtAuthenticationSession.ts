import type { H3Event } from 'h3'
import { clearUserSession, getUserSession, setUserSession } from '#imports'
import type {
  AdministratorSessionPrincipal,
  AuthenticationSession,
} from '../../ports/AuthenticationPorts'

/** 通过 nuxt-auth-utils 的密封 Cookie 实现当前请求会话。 */
export class NuxtAuthenticationSession implements AuthenticationSession {
  /**
   * 创建请求级会话适配器。
   * @param event 当前 H3 请求事件。
   */
  constructor(private readonly event: H3Event) {}

  /**
   * 读取 Cookie 中的最小管理员身份。
   * @returns 已登录身份；不存在完整用户字段时返回 null。
   */
  async getPrincipal(): Promise<AdministratorSessionPrincipal | null> {
    const session = await getUserSession(this.event)
    const user = session.user
    if (!user?.id || !user.username || !Number.isInteger(user.credentialVersion)) {
      return null
    }

    return {
      id: user.id,
      username: user.username,
      credentialVersion: user.credentialVersion,
    }
  }

  /**
   * 用最小身份替换当前密封会话。
   * @param principal 已通过应用服务验证的管理员身份。
   * @returns 无返回值。
   */
  async setPrincipal(principal: AdministratorSessionPrincipal): Promise<void> {
    await setUserSession(this.event, {
      user: principal,
      loggedInAt: Date.now(),
    })
  }

  /**
   * 清除当前请求的会话 Cookie。
   * @returns 无返回值。
   */
  async clear(): Promise<void> {
    await clearUserSession(this.event)
  }
}
