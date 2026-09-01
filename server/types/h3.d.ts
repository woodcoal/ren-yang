import type { RequestApplicationServices } from '../application/RequestApplicationServices'
import type { ApiKeyPrincipal } from '../../shared/types/publicApi'

declare module 'h3' {
  interface H3EventContext {
    /** 由应用组合根注入，控制器和中间件只能调用这些应用服务。 */
    applicationServices: RequestApplicationServices
    /** 请求日志、公共响应与审计共用的追踪标识。 */
    requestId?: string
    /** 公共 v2 请求完成认证后附加的 API Key 主体。 */
    apiKeyPrincipal?: ApiKeyPrincipal
  }
}

export {}
