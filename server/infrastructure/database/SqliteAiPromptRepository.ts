import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { AiPromptDraftView, AiPromptVariableView, AiPromptVersionView } from '../../../shared/types/aiPrompt'
import type {
  AiPromptDefinitionRecord,
  AiPromptRepository,
  SaveAiPromptDraftRecord,
} from '../../ports/AiPromptRepository'

/** 使用 SQLite 管理固定 AI 提示词、唯一草稿和不可变发布版本。 */
export class SqliteAiPromptRepository implements AiPromptRepository {
  /**
   * 创建 AI 提示词仓储。
   * @param client 已迁移并启用外键的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 按分类和名称排序的全部固定提示词定义。 */
  async listDefinitions(): Promise<AiPromptDefinitionRecord[]> {
    return this.client.prepare(`
      SELECT * FROM ai_prompts ORDER BY category ASC, name ASC, code ASC
    `).all().map(toDefinition)
  }

  /** @param code 提示词稳定编码。 @returns 定义或 null。 */
  async findDefinition(code: string): Promise<AiPromptDefinitionRecord | null> {
    const row = this.client.prepare('SELECT * FROM ai_prompts WHERE code = ?').get(code)
    return row ? toDefinition(row) : null
  }

  /** @param code 提示词稳定编码。 @returns 当前草稿或 null。 */
  async findDraft(code: string): Promise<AiPromptDraftView | null> {
    const row = this.client.prepare('SELECT * FROM ai_prompt_drafts WHERE prompt_code = ?').get(code)
    return row ? toDraft(row) : null
  }

  /** @param code 提示词稳定编码。 @returns 新版本在前的全部历史。 */
  async listVersions(code: string): Promise<AiPromptVersionView[]> {
    return this.client.prepare(`
      SELECT * FROM ai_prompt_versions
      WHERE prompt_code = ?
      ORDER BY version_no DESC
    `).all(code).map(toVersion)
  }

  /** @param versionId 版本 UUID。 @returns 指定不可变版本或 null。 */
  async findVersion(versionId: string): Promise<AiPromptVersionView | null> {
    const row = this.client.prepare('SELECT * FROM ai_prompt_versions WHERE id = ?').get(versionId)
    return row ? toVersion(row) : null
  }

  /** @param record 完整草稿记录。 @returns 保存后的草稿。 */
  async saveDraft(record: SaveAiPromptDraftRecord): Promise<AiPromptDraftView> {
    this.client.prepare(`
      INSERT INTO ai_prompt_drafts (
        id, prompt_code, base_version_id, system_prompt_template, user_prompt_template,
        change_summary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prompt_code) DO UPDATE SET
        base_version_id = excluded.base_version_id,
        system_prompt_template = excluded.system_prompt_template,
        user_prompt_template = excluded.user_prompt_template,
        change_summary = excluded.change_summary,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.promptCode,
      record.baseVersionId,
      record.systemPromptTemplate,
      record.userPromptTemplate,
      record.changeSummary,
      record.timestamp,
      record.timestamp,
    )
    const saved = await this.findDraft(record.promptCode)
    if (!saved) throw new Error('AI 提示词草稿保存后无法读取')
    return saved
  }

  /** @param code 提示词稳定编码。 @returns 删除到草稿时为 true。 */
  async deleteDraft(code: string): Promise<boolean> {
    return this.client.prepare('DELETE FROM ai_prompt_drafts WHERE prompt_code = ?').run(code).changes === 1
  }

  /**
   * 原子发布当前草稿，并将固定定义指向新版本。
   * @param code 提示词编码。
   * @param expectedDraftUpdatedAt 预期草稿更新时间。
   * @param versionId 新版本 UUID。
   * @param timestamp 发布时间。
   * @returns 发布后的版本；并发冲突时为 null。
   */
  async publishDraft(
    code: string,
    expectedDraftUpdatedAt: number,
    versionId: string,
    timestamp: number,
  ): Promise<AiPromptVersionView | null> {
    const transaction = this.client.transaction(() => {
      const draft = this.client.prepare(`
        SELECT * FROM ai_prompt_drafts WHERE prompt_code = ? AND updated_at = ?
      `).get(code, expectedDraftUpdatedAt) as Record<string, unknown> | undefined
      const definition = this.client.prepare('SELECT active_version_id FROM ai_prompts WHERE code = ?').get(code) as Record<string, unknown> | undefined
      if (!draft || !definition || nullableString(definition.active_version_id) !== nullableString(draft.base_version_id)) return false
      const next = this.client.prepare(`
        SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no
        FROM ai_prompt_versions WHERE prompt_code = ?
      `).get(code) as { version_no: number }
      this.client.prepare(`
        INSERT INTO ai_prompt_versions (
          id, prompt_code, version_no, system_prompt_template, user_prompt_template,
          change_summary, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId,
        code,
        next.version_no,
        draft.system_prompt_template,
        draft.user_prompt_template,
        draft.change_summary,
        timestamp,
      )
      this.client.prepare(`
        UPDATE ai_prompts SET active_version_id = ?, updated_at = ? WHERE code = ?
      `).run(versionId, timestamp, code)
      this.client.prepare('DELETE FROM ai_prompt_drafts WHERE prompt_code = ?').run(code)
      return true
    })
    if (!transaction()) return null
    return await this.findVersion(versionId)
  }
}

/**
 * 把 SQLite 定义行转换为严格业务记录。
 * @param value SQLite 查询行。
 * @returns 固定提示词定义。
 */
function toDefinition(value: unknown): AiPromptDefinitionRecord {
  const row = value as Record<string, unknown>
  return {
    code: String(row.code),
    name: String(row.name),
    category: String(row.category),
    description: String(row.description),
    kind: row.kind === 'image' ? 'image' : 'text',
    variables: JSON.parse(String(row.variables_json)) as AiPromptVariableView[],
    activeVersionId: nullableString(row.active_version_id),
    updatedAt: Number(row.updated_at),
  }
}

/**
 * 把 SQLite 草稿行转换为公开视图。
 * @param value SQLite 查询行。
 * @returns 当前提示词草稿。
 */
function toDraft(value: unknown): AiPromptDraftView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id),
    promptCode: String(row.prompt_code),
    baseVersionId: nullableString(row.base_version_id),
    systemPromptTemplate: nullableString(row.system_prompt_template),
    userPromptTemplate: String(row.user_prompt_template),
    changeSummary: String(row.change_summary),
    updatedAt: Number(row.updated_at),
  }
}

/**
 * 把 SQLite 版本行转换为公开视图。
 * @param value SQLite 查询行。
 * @returns 不可变发布版本。
 */
function toVersion(value: unknown): AiPromptVersionView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id),
    promptCode: String(row.prompt_code),
    versionNo: Number(row.version_no),
    systemPromptTemplate: nullableString(row.system_prompt_template),
    userPromptTemplate: String(row.user_prompt_template),
    changeSummary: String(row.change_summary),
    publishedAt: Number(row.published_at),
  }
}

/**
 * 归一化 SQLite 可空文本。
 * @param value SQLite 行中的未知值。
 * @returns null 或字符串。
 */
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}
