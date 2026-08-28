import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ContextProvider, EvidenceCandidate, EvidenceSearchRequest } from '../../ports/ContextProvider'

/** 使用人物和世界关联范围执行 SQLite FTS5 检索。 */
export class SqliteContextProvider implements ContextProvider {
  /**
   * 创建本地上下文提供器。
   * @param client 已迁移且启用 FTS5 的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /**
   * 在直接关联人物或世界的资料中检索，并按证据角色和显式优先级排序。
   * @param request 目标范围、自然语言任务和结果上限。
   * @returns 去重后的证据候选。
   */
  async search(request: EvidenceSearchRequest): Promise<EvidenceCandidate[]> {
    if (request.limit === 0) return []
    const ftsQuery = buildFtsQuery(request.query)
    if (!ftsQuery) return []
    const rows = this.client.prepare(`
      WITH linked_sources AS (
        SELECT source_id, MIN(priority) AS priority
        FROM (
          SELECT source_id, priority FROM persona_sources WHERE persona_id = ?
          UNION ALL
          SELECT source_id, priority FROM world_sources WHERE world_id = ?
        ) GROUP BY source_id
      )
      SELECT source_chunks.id AS chunk_id, source_chunks.source_id, source_materials.role,
             source_chunks.heading, source_chunks.content, source_chunks.content_hash,
             linked_sources.priority
      FROM source_chunks_fts
      INNER JOIN source_chunks ON source_chunks.rowid = source_chunks_fts.rowid
      INNER JOIN source_materials ON source_materials.id = source_chunks.source_id
      INNER JOIN linked_sources ON linked_sources.source_id = source_chunks.source_id
      WHERE source_chunks_fts MATCH ?
      ORDER BY CASE source_materials.role
        WHEN 'canon_fact' THEN 0 WHEN 'style_sample' THEN 1 ELSE 2 END,
        linked_sources.priority, bm25(source_chunks_fts), source_chunks.ordinal
      LIMIT ?
    `).all(request.personaId, request.worldId ?? '', ftsQuery, request.limit)
    return rows.map(toEvidenceCandidate)
  }
}

/**
 * 从长任务文本提取有限数量的 FTS5 trigram 短语，防止整段精确匹配无结果。
 * @param value 用户任务或待判断内容。
 * @returns 使用参数传入 MATCH 的安全 OR 查询；无有效字符时返回空字符串。
 */
function buildFtsQuery(value: string): string {
  const segments = value
    .split(/[\s，。！？；：、,.!?;:\n\r]+/u)
    .map(segment => segment.trim())
    .filter(segment => [...segment].length >= 3)
  const terms = new Set<string>()
  for (const segment of segments) {
    const characters = [...segment]
    if (characters.length <= 4) {
      terms.add(segment)
    }
    else {
      for (let offset = 0; offset <= characters.length - 4 && terms.size < 12; offset += 4) {
        terms.add(characters.slice(offset, offset + 4).join(''))
      }
    }
    if (terms.size >= 12) break
  }
  return [...terms].map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')
}

/** @param value SQLite 查询行。 @returns 统一证据候选。 */
function toEvidenceCandidate(value: unknown): EvidenceCandidate {
  const row = value as Record<string, unknown>
  return {
    sourceId: String(row.source_id),
    chunkId: String(row.chunk_id),
    role: row.role as EvidenceCandidate['role'],
    heading: row.heading === null ? null : String(row.heading),
    content: String(row.content),
    contentHash: String(row.content_hash),
    priority: Number(row.priority),
  }
}
