import type { AuthenticationApplicationService } from './authentication/AuthenticationApplicationService'
import type { ContentApplicationService } from './content/ContentApplicationService'
import type { SoulApplicationService } from './content/SoulApplicationService'
import type { GenerationApplicationService } from './generation/GenerationApplicationService'
import type { FeedbackApplicationService } from './feedback/FeedbackApplicationService'
import type { SystemApplicationService } from './system/SystemApplicationService'
import type { ContextSynchronizationApplicationService } from './context/ContextSynchronizationApplicationService'
import type { BackupApplicationService } from './backup/BackupApplicationService'
import type { LearningApplicationService } from './learning/LearningApplicationService'
import type { AnalysisApplicationService } from './analysis/AnalysisApplicationService'
import type { HistoryApplicationService } from './history/HistoryApplicationService'

/** 每个 HTTP 请求能够访问的应用服务集合。 */
export interface RequestApplicationServices {
  /** 认证相关用例。 */
  authentication: AuthenticationApplicationService
  /** 人物、世界、版本和资料用例。 */
  content: ContentApplicationService
  /** 世界与人物灵魂草稿及发布用例。 */
  soul: SoulApplicationService
  /** 世界成长、人物成长和人物记忆人工管理用例。 */
  learning: LearningApplicationService
  /** AI 成长与记忆提炼批次用例。 */
  analysis: AnalysisApplicationService
  /** 兴趣判断、文档规划、生成和运行历史用例。 */
  generation: GenerationApplicationService
  /** 生成运行与分析批次统一任务记录用例。 */
  history: HistoryApplicationService
  /** 反馈归因、一次性动作和人物成长素材确认用例。 */
  feedback: FeedbackApplicationService
  /** OpenViking 检测、同步状态和全量重建用例。 */
  contextSynchronization: ContextSynchronizationApplicationService
  /** 在线创建和只读验证一致性备份的用例。 */
  backup: BackupApplicationService
  /** 非敏感系统状态用例。 */
  system: SystemApplicationService
}
