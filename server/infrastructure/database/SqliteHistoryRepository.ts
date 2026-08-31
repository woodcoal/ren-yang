import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ListHistoryPageInput } from '../../../shared/schemas/history'
import type { HistoryItemView, HistoryPageView } from '../../../shared/types/history'
import type { HistoryRepository } from '../../ports/HistoryRepository'

/** 参数化 SQL 及按占位符顺序排列的绑定参数。 */
interface HistoryQuery {
  sql: string
  parameters: unknown[]
}

/** 使用 SQLite 合并生成运行与分析批次，并提供准确分页。 */
export class SqliteHistoryRepository implements HistoryRepository {
  /**
   * 创建任务记录仓储。
   * @param client 已完成迁移的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /**
   * 按筛选条件合并两类任务记录并执行稳定分页。
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
 * 为生成运行与分析批次构造使用相同筛选语义的 UNION 查询。
 * @param input 已校验的分页与筛选参数。
 * @returns 不含排序和分页、可复用于计数与取页的参数化查询。
 */
function buildHistoryQuery(input: ListHistoryPageInput): HistoryQuery {
  const runClauses: string[] = []
  const runParameters: unknown[] = []
  const analysisClauses: string[] = []
  const analysisParameters: unknown[] = []
  if (input.personaId) {
    runClauses.push('soul_versions.persona_id = ?')
    runParameters.push(input.personaId)
    analysisClauses.push('analysis_batches.persona_id = ?')
    analysisParameters.push(input.personaId)
  }
  if (input.kind) {
    runClauses.push('generation_runs.kind = ?')
    runParameters.push(input.kind)
    analysisClauses.push('analysis_batches.analysis_type = ?')
    analysisParameters.push(input.kind)
  }
  if (input.status) {
    runClauses.push('generation_runs.status = ?')
    runParameters.push(input.status)
    analysisClauses.push('analysis_batches.status = ?')
    analysisParameters.push(input.status)
  }
  const runWhere = runClauses.length ? `WHERE ${runClauses.join(' AND ')}` : ''
  const analysisWhere = analysisClauses.length ? `WHERE ${analysisClauses.join(' AND ')}` : ''

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
    `,
    parameters: [...runParameters, ...analysisParameters],
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
