import type { RequestApplicationServices } from '../application/RequestApplicationServices'

declare module 'h3' {
  interface H3EventContext {
    /** 由应用组合根注入，控制器和中间件只能调用这些应用服务。 */
    applicationServices: RequestApplicationServices
  }
}

export {}
