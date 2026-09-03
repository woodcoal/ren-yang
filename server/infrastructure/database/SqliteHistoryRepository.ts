import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ListHistoryPageInput } from '../../../shared/schemas/history'
import type { HistoryItemView, HistoryPageView } from '../../../shared/types/history'
import type { HistoryRepository } from '../../ports/HistoryRepository'

/** 参数化 SQL 及按占位符顺序排列的绑定参数。 */
interface HistoryQuery {
  sql: string
  parameters: unknown[]
}

/** 使用 SQLite 合并人物蒸馏、生成运行与分析批次，并提供准确分页。 */
export class SqliteHistoryRepository implements HistoryRepository {
  /**
   * 创建任务记录仓储。
   * @param client 已完成迁移的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /**
   * 按筛选条件合并四类任务记录并执行稳定分页。
   * @param input 已校验的分页与筛选参数。
   * @returns 当前页记录、准确总数和服务端修正后的页码。
   */
  async listPage(input: ListHistoryPageInput): Promise<HistoryPageView> {
    const query = buildHistoryQuery(input)
    const count = this.client.prepare(`SELECT COUNT(*) AS total FROM (${query.sql})`)
      .get(...query.parameters) as { total: number }
    const total = Number(count.total)
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize))
    const page = Math.min(input.page, totalPages)
    const items = this.client.prepare(`
      SELECT * FROM (${query.sql})
      ORDER BY created_at DESC, id DESC, source_type
      LIMIT ? OFFSET ?
    `).all(...query.parameters, input.pageSize, (page - 1) * input.pageSize).map(toHistoryItem)
    return { items, total, page, pageSize: input.pageSize, totalPages }
  }

}

/**
 * 为人物蒸馏、生成运行与分析批次构造使用相同筛选语义的 UNION 查询。
 * @param input 已校验的分页与筛选参数。
 * @returns 不含排序和分页、可复用于计数与取页的参数化查询。
 */
function buildHistoryQuery(input: ListHistoryPageInput): HistoryQuery {
  const runClauses: string[] = []
  const runParameters: unknown[] = []
  const batchClauses: string[] = []
  const batchParameters: unknown[] = []
  const analysisClauses: string[] = []
  const analysisParameters: unknown[] = []
  const distillationClauses: string[] = []
  const distillationParameters: unknown[] = []
  const batchStatusExpression = `CASE
    WHEN SUM(CASE WHEN generation_runs.status = 'running' THEN 1 ELSE 0 END) > 0 THEN 'running'
    WHEN SUM(CASE WHEN generation_runs.status IN ('planning', 'awaiting_confirmation', 'queued') THEN 1 ELSE 0 END) > 0 THEN 'queued'
    WHEN SUM(CASE WHEN generation_runs.status = 'succeeded' THEN 1 ELSE 0 END) = COUNT(*) THEN 'succeeded'
    WHEN SUM(CASE WHEN generation_runs.status = 'canceled' THEN 1 ELSE 0 END) = COUNT(*) THEN 'canceled'
    WHEN SUM(CASE WHEN generation_runs.status = 'succeeded' THEN 1 ELSE 0 END) > 0 THEN 'partial'
    ELSE 'failed'
  END`
  const distillationStatusExpression = `CASE persona_distillation_runs.status
    WHEN 'analyzing' THEN 'running'
    WHEN 'awaiting_candidate_review' THEN 'awaiting_review'
    ELSE persona_distillation_runs.status
  END`
  runClauses.push('NOT EXISTS (SELECT 1 FROM interest_batch_items WHERE interest_batch_items.run_id = generation_runs.id)')
  if (input.personaId) {
    runClauses.push('soul_versions.persona_id = ?')
    runParameters.push(input.personaId)
    batchClauses.push('interest_batch_history.subject_id = ?')
    batchParameters.push(input.personaId)
    analysisClauses.push('analysis_batches.persona_id = ?')
    analysisParameters.push(input.personaId)
    distillationClauses.push('persona_distillation_runs.created_persona_id = ?')
    distillationParameters.push(input.personaId)
  }
  if (input.kind) {
    runClauses.push('generation_runs.kind = ?')
    runParameters.push(input.kind)
    if (input.kind !== 'interest_assessment') batchClauses.push('1 = 0')
    analysisClauses.push('analysis_batches.analysis_type = ?')
    analysisParameters.push(input.kind)
    if (input.kind !== 'persona_distillation') distillationClauses.push('1 = 0')
  }
  if (input.status) {
    runClauses.push('generation_runs.status = ?')
    runParameters.push(input.status)
    batchClauses.push('interest_batch_history.status = ?')
    batchParameters.push(input.status)
    analysisClauses.push('analysis_batches.status = ?')
    analysisParameters.push(input.status)
    distillationClauses.push(`${distillationStatusExpression} = ?`)
    distillationParameters.push(input.status)
  }
  const runWhere = runClauses.length ? `WHERE ${runClauses.join(' AND ')}` : ''
  const batchWhere = batchClauses.length ? `WHERE ${batchClauses.join(' AND ')}` : ''
  const analysisWhere = analysisClauses.length ? `WHERE ${analysisClauses.join(' AND ')}` : ''
  const distillationWhere = distillationClauses.length ? `WHERE ${distillationClauses.join(' AND ')}` : ''

  return {
    sql: `
      SELECT
        'run' AS source_type,
        generation_runs.id AS id,
        generation_runs.kind AS kind,
        'persona' AS subject_type,
        soul_versions.persona_id AS subject_id,
        COALESCE(personas.name, '已删除人物') AS subject_name,
        CASE WHEN personas.id IS NULL THEN 0 ELSE 1 END AS subject_exists,
        generation_runs.status AS status,
        COALESCE(
          CASE generation_runs.kind
            WHEN 'interest_assessment' THEN json_extract(generation_runs.input_json, '$.content')
            ELSE json_extract(generation_runs.input_json, '$.requirement')
          END,
          '无任务输入'
        ) AS description,
        COALESCE(json_extract(generation_runs.model_snapshot_json, '$.model'), '未知模型') AS secondary,
        generation_runs.error_code AS error_code,
        generation_runs.error_message AS error_message,
        generation_runs.created_at AS created_at
      FROM generation_runs
      INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
      LEFT JOIN personas ON personas.id = soul_versions.persona_id
      ${runWhere}
      UNION ALL
      SELECT * FROM (
        SELECT
          'interest_batch' AS source_type,
          interest_batches.id AS id,
          'interest_assessment' AS kind,
          'persona' AS subject_type,
          interest_batches.persona_id AS subject_id,
          COALESCE(personas.name, '已删除人物') AS subject_name,
          CASE WHEN personas.id IS NULL THEN 0 ELSE 1 END AS subject_exists,
          ${batchStatusExpression} AS status,
          COUNT(*) || ' 条文本' AS description,
          '成功 ' || SUM(CASE WHEN generation_runs.status = 'succeeded' THEN 1 ELSE 0 END)
            || ' / 失败 ' || SUM(CASE WHEN generation_runs.status IN ('failed', 'canceled') THEN 1 ELSE 0 END) AS secondary,
          MAX(generation_runs.error_code) AS error_code,
          MAX(generation_runs.error_message) AS error_message,
          interest_batches.created_at AS created_at
        FROM interest_batches
        INNER JOIN interest_batch_items ON interest_batch_items.batch_id = interest_batches.id
        INNER JOIN generation_runs ON generation_runs.id = interest_batch_items.run_id
        LEFT JOIN personas ON personas.id = interest_batches.persona_id
        GROUP BY interest_batches.id, interest_batches.persona_id, personas.id, personas.name, interest_batches.created_at
      ) AS interest_batch_history
      ${batchWhere}
      UNION ALL
      SELECT
        'analysis' AS source_type,
        analysis_batches.id AS id,
        analysis_batches.analysis_type AS kind,
        CASE analysis_batches.analysis_type WHEN 'world_growth' THEN 'world' ELSE 'persona' END AS subject_type,
        COALESCE(analysis_batches.world_id, analysis_batches.persona_id) AS subject_id,
        COALESCE(worlds.name, personas.name,
          CASE analysis_batches.analysis_type WHEN 'world_growth' THEN '已删除世界' ELSE '已删除人物' END
        ) AS subject_name,
        CASE WHEN worlds.id IS NULL AND personas.id IS NULL THEN 0 ELSE 1 END AS subject_exists,
        analysis_batches.status AS status,
        COALESCE(
          json_extract(analysis_batches.raw_result_json, '$.summary'),
          analysis_batches.error_message,
          (SELECT COUNT(*) FROM analysis_batch_inputs WHERE batch_id = analysis_batches.id) || ' 项原始素材'
        ) AS description,
        CASE analysis_batches.mode WHEN 'incremental' THEN '结合新增素材' ELSE '全部素材重建' END AS secondary,
        analysis_batches.error_code AS error_code,
        analysis_batches.error_message AS error_message,
        analysis_batches.created_at AS created_at
      FROM analysis_batches
      LEFT JOIN worlds ON worlds.id = analysis_batches.world_id
      LEFT JOIN personas ON personas.id = analysis_batches.persona_id
      ${analysisWhere}
      UNION ALL
      SELECT
        'distillation' AS source_type,
        persona_distillation_runs.id AS id,
        'persona_distillation' AS kind,
        'persona' AS subject_type,
        COALESCE(personas.id, persona_distillation_runs.id) AS subject_id,
        COALESCE(personas.name, persona_distillation_runs.requested_name) AS subject_name,
        CASE WHEN personas.id IS NULL THEN 0 ELSE 1 END AS subject_exists,
        ${distillationStatusExpression} AS status,
        persona_distillation_runs.objective AS description,
        CASE persona_distillation_runs.status
          WHEN 'analyzing' THEN '正在自由分析'
          WHEN 'awaiting_candidate_review' THEN '等待候选确认'
          WHEN 'completed' THEN '人物已创建'
          WHEN 'failed' THEN '执行失败'
          ELSE '已取消'
        END AS secondary,
        persona_distillation_runs.error_code AS error_code,
        persona_distillation_runs.error_message AS error_message,
        persona_distillation_runs.created_at AS created_at
      FROM persona_distillation_runs
      LEFT JOIN personas ON personas.id = persona_distillation_runs.created_persona_id
      ${distillationWhere}
    `,
    parameters: [...runParameters, ...batchParameters, ...analysisParameters, ...distillationParameters],
  }
}

/**
 * 把统一查询行转换为公开任务记录。
 * @param value SQLite 查询行。
 * @returns 类型明确的任务记录。
 */
function toHistoryItem(value: unknown): HistoryItemView {
  const item = value as Record<string, unknown>
  return {
    sourceType: item.source_type as HistoryItemView['sourceType'],
    id: String(item.id),
    kind: item.kind as HistoryItemView['kind'],
    subjectType: item.subject_type as HistoryItemView['subjectType'],
    subjectId: String(item.subject_id),
    subjectName: String(item.subject_name),
    subjectExists: Number(item.subject_exists) === 1,
    status: item.status as HistoryItemView['status'],
    description: String(item.description),
    secondary: String(item.secondary),
    errorCode: item.error_code === null ? null : String(item.error_code),
    errorMessage: item.error_message === null ? null : String(item.error_message),
    createdAt: Number(item.created_at),
  }
}
