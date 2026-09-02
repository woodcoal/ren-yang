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
import type { AiPromptApplicationService } from './aiPrompts/AiPromptApplicationService'
import type { HistoryApplicationService } from './history/HistoryApplicationService'
import type { AiConfigurationApplicationService } from './aiConfiguration/AiConfigurationApplicationService'
import type { AiAlgorithmTestApplicationService } from './aiConfiguration/AiAlgorithmTestApplicationService'
import type { ApiKeyApplicationService } from './authentication/ApiKeyApplicationService'
import type { PublicApiApplicationService } from './publicApi/PublicApiApplicationService'
import type { SystemAiSettingsApplicationService } from './systemAi/SystemAiSettingsApplicationService'
import type { LearningAutomationApplicationService } from './learningAutomation/LearningAutomationApplicationService'
import type { PersonaDistillationApplicationService } from './distillation/PersonaDistillationApplicationService'

/** 每个 HTTP 请求能够访问的应用服务集合。 */
export interface RequestApplicationServices {
  /** 管理员 API Key 生命周期和公共请求认证用例。 */
  apiKeys: ApiKeyApplicationService
  /** 公共写请求幂等与脱敏审计用例。 */
  publicApi: PublicApiApplicationService
  /** 加密 AI 接口、模型部署和固定算法配置用例。 */
  aiConfiguration: AiConfigurationApplicationService
  /** 全站默认文本与图片模型设置用例。 */
  systemAiSettings: SystemAiSettingsApplicationService
  /** 固定 AI 算法的真实调用、草稿优先且不落库测试用例。 */
  aiAlgorithmTesting: AiAlgorithmTestApplicationService
  /** 全站 AI 提示词草稿、发布、历史和运行时目录。 */
  aiPrompts: AiPromptApplicationService
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
  /** 人物创建或已有人物重新蒸馏的资料覆盖、认知提取、候选评测和确认用例。 */
  personaDistillation: PersonaDistillationApplicationService
  /** 定时提炼、自动发布和统一周期设置用例。 */
  learningAutomation: LearningAutomationApplicationService
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
