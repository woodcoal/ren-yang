import type { AuthenticationApplicationService } from './authentication/AuthenticationApplicationService'
import type { SystemApplicationService } from './system/SystemApplicationService'

/** 每个 HTTP 请求能够访问的应用服务集合。 */
export interface RequestApplicationServices {
  /** 认证相关用例。 */
  authentication: AuthenticationApplicationService
  /** 非敏感系统状态用例。 */
  system: SystemApplicationService
}
