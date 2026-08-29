import type { TextModelParameters } from '../../shared/schemas/generation'
import type { ModelIterationResult, ReviewIterationProposalsInput } from '../../shared/schemas/analysis'
import type { AnalysisBatchView, AnalysisType } from '../../shared/types/analysis'
import type { TextModelSnapshot } from '../domain/generation/GenerationModels'

/** 创建分析批次的单项不可变输入。 */
export interface CreateAnalysisBatchInputRecord {
  /** 批次输入 UUID。 */
  id: string
  /** 原始数据类型。 */
  inputType: 'world_source' | 'persona_feedback_source' | 'persona_operation_record' | 'openviking_memory'
  /** SQLite 原始数据 UUID。 */
  inputId: string
  /** 标题或摘要。 */
  title: string
  /** 分析时完整正文。 */
  content: string
  /** SHA-256。 */
  contentHash: string
  /** 是否属于本次新增输入。 */
  isNew: boolean
}

/** 创建分析批次和持久任务的命令。 */
export interface CreateAnalysisBatchRecord {
  /** 批次 UUID。 */
  id: string
  /** Worker 任务 UUID。 */
  taskId: string
  /** 分析类型。 */
  analysisType: AnalysisType
  /** 所属对象 UUID。 */
  subjectId: string
  /** 分析模式。 */
  mode: 'incremental' | 'full_rebuild'
  /** 当前灵魂版本 UUID。 */
  baselineSoulVersionId: string
  /** 当前有效成长或记忆快照。 */
  baseline: unknown[]
  /** 固定模型快照。 */
  model: TextModelSnapshot
  /** 固定参数快照。 */
  parameters: TextModelParameters
  /** 分析提示版本。 */
  promptVersion: string
  /** 实际输入。 */
  inputs: CreateAnalysisBatchInputRecord[]
  /** 创建时间。 */
  timestamp: number
}

/** Worker 执行分析所需的固定批次数据。 */
export interface AnalysisBatchRuntimeRecord {
  /** 批次公开视图。 */
  batch: AnalysisBatchView
  /** 当前有效成长或记忆快照。 */
  baseline: unknown[]
  /** 固定模型快照。 */
  model: TextModelSnapshot
  /** 固定参数快照。 */
  parameters: TextModelParameters
  /** 分析提示版本。 */
  promptVersion: string
}

/** AI 分析批次、提案和原子审核事实源。 */
export interface AnalysisRepository {
  /** @param record 完整批次命令。 @returns 无返回值。 */
  createBatch(record: CreateAnalysisBatchRecord): Promise<void>
  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @returns 最新批次或 null。 */
  findLatestBatch(analysisType: AnalysisType, subjectId: string): Promise<AnalysisBatchView | null>
  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @returns 已进入成功分析批次的原始输入 UUID。 */
  listAnalyzedInputIds(analysisType: AnalysisType, subjectId: string): Promise<string[]>
  /** @param batchId 批次 UUID。 @returns 完整批次或 null。 */
  findBatch(batchId: string): Promise<AnalysisBatchView | null>
  /** @param batchId 批次 UUID。 @param timestamp 开始时间。 @returns 固定运行数据或 null。 */
  startBatch(batchId: string, timestamp: number): Promise<AnalysisBatchRuntimeRecord | null>
  /** @param batchId 批次 UUID。 @param result 已校验模型结果。 @param timestamp 完成时间。 @returns 是否保存成功。 */
  saveAnalysisResult(batchId: string, result: ModelIterationResult, timestamp: number): Promise<boolean>
  /** @param batchId 批次 UUID。 @param code 稳定错误码。 @param message 脱敏错误。 @param timestamp 失败时间。 @returns 无返回值。 */
  failBatch(batchId: string, code: string, message: string, timestamp: number): Promise<void>
  /** @param batchId 批次 UUID。 @param input 审核决定。 @param timestamp 审核时间。 @returns 审核并幂等应用后的批次或 null。 */
  reviewAndApply(batchId: string, input: ReviewIterationProposalsInput, timestamp: number): Promise<AnalysisBatchView | null>
}
