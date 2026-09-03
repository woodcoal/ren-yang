import type { FeedbackResolutionImpactRecord } from '../domain/feedback/FeedbackModels'
import type {
  FeedbackEventRecord,
  FeedbackResolutionRecord,
  FeedbackSuggestionRecord,
} from '../domain/feedback/FeedbackModels'

/** 反馈列表使用的完整聚合读取结果。 */
export interface FeedbackAggregate {
  event: FeedbackEventRecord
  suggestion: FeedbackSuggestionRecord
  resolution: FeedbackResolutionRecord | null
}

/** 人物反馈转为成长素材的事务所需事实。 */
export interface ConfirmPersonaLearningFeedbackCommand {
  /** 原始反馈 UUID。 */
  feedbackId: string
  /** 新成长素材与兼容反馈资料共用的 UUID。 */
  feedbackSourceId: string
  /** 反馈所属运行固定的人物 UUID。 */
  personaId: string
  /** 成长素材池展示标题。 */
  title: string
  /** 统一确认时间。 */
  timestamp: number
}

/** 反馈、确认动作和人物成长素材的事务事实源端口。 */
export interface FeedbackRepository {
  /** @param event 原始反馈。 @param suggestion AI 分类建议。 @returns 运行和块关系有效时为 true。 */
  createFeedback(event: FeedbackEventRecord, suggestion: FeedbackSuggestionRecord): Promise<boolean>
  /** @returns 新反馈在前的完整反馈聚合。 */
  listFeedback(): Promise<FeedbackAggregate[]>
  /** @param feedbackId 反馈 UUID。 @returns 反馈聚合或 null。 */
  findFeedback(feedbackId: string): Promise<FeedbackAggregate | null>
  /** @param runId 运行 UUID。 @returns 运行固定的人物，找不到时为 null。 */
  findRunPersona(runId: string): Promise<{ personaId: string } | null>
  /** @param feedbackId 反馈 UUID。 @param blockId 块 UUID。 @param taskId 新任务 UUID。 @param timestamp 确认时间。 @returns 原子确认和入队是否成功。 */
  confirmArtifactFeedback(feedbackId: string, blockId: string, taskId: string, timestamp: number): Promise<boolean>
  /** @param feedbackId 反馈 UUID。 @param targetType 参数或资料目标。 @param resolution 业务结果。 @param timestamp 确认时间。 @returns 是否首次确认。 */
  confirmSimpleFeedback(feedbackId: string, targetType: 'parameters' | 'source_fact', resolution: Record<string, unknown>, timestamp: number): Promise<boolean>
  /** @param command 原始反馈、所属人物和新成长素材事实。 @returns 是否原子确认并创建人物成长素材。 */
  confirmPersonaLearningFeedback(command: ConfirmPersonaLearningFeedbackCommand): Promise<boolean>
  /** @param feedbackId 反馈 UUID。 @returns 已确认动作的跨表审计关系；不存在或未确认时为空。 */
  findResolutionImpact(feedbackId: string): Promise<FeedbackResolutionImpactRecord | null>
  /** @param sourceId 资料 UUID。 @returns 资料是否存在。 */
  sourceExists(sourceId: string): Promise<boolean>
}
