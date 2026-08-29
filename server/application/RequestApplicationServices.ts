import type { AuthenticationApplicationService } from './authentication/AuthenticationApplicationService'
import type { ContentApplicationService } from './content/ContentApplicationService'
import type { GenerationApplicationService } from './generation/GenerationApplicationService'
import type { FeedbackApplicationService } from './feedback/FeedbackApplicationService'
import type { SystemApplicationService } from './system/SystemApplicationService'
import type { ContextSynchronizationApplicationService } from './context/ContextSynchronizationApplicationService'
import type { BackupApplicationService } from './backup/BackupApplicationService'

/** 每个 HTTP 请求能够访问的应用服务集合。 */
export interface RequestApplicationServices {
  /** 认证相关用例。 */
  authentication: AuthenticationApplicationService
  /** 人物、世界、版本和资料用例。 */
  content: ContentApplicationService
  /** 兴趣判断、文档规划、生成和运行历史用例。 */
  generation: GenerationApplicationService
  /** 反馈归因、修订提案、评测和发布用例。 */
  feedback: FeedbackApplicationService
  /** OpenViking 检测、同步状态和全量重建用例。 */
  contextSynchronization: ContextSynchronizationApplicationService
  /** 在线创建和只读验证一致性备份的用例。 */
  backup: BackupApplicationService
  /** 非敏感系统状态用例。 */
  system: SystemApplicationService
}
