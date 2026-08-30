import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteHistoryRepository } from '../../server/infrastructure/database/SqliteHistoryRepository'

let directory: string
let database: SqliteDatabase
let repository: SqliteHistoryRepository

/**
 * 写入六项按时间交错的生成运行与分析批次，验证统一分页不会按来源分组。
 * @returns 测试数据写入完成时结束。
 */
function seedHistoryRecords(): void {
  const client = database.getClient()
  client.prepare(`
    INSERT INTO worlds (id, name, summary, created_at, updated_at)
    VALUES ('20000000-0000-4000-8000-000000000001', '浮岛纪元', '', 1, 1)
  `).run()
  client.prepare(`
    INSERT INTO personas (id, world_id, name, origin, created_at, updated_at)
    VALUES ('10000000-0000-4000-8000-000000000001', NULL, '林默', 'original', 1, 1)
  `).run()
  client.prepare(`
    INSERT INTO soul_versions (
      id, subject_type, persona_id, prompt_text, runtime_token_count,
      token_counter, change_summary, status, published_at, created_at
    ) VALUES (
      '11000000-0000-4000-8000-000000000001', 'persona',
      '10000000-0000-4000-8000-000000000001', '测试人物', 2,
      'test', '建立测试人物', 'published', 1, 1
    )
  `).run()

  const insertRun = client.prepare(`
    INSERT INTO generation_runs (
      id, kind, persona_version_id, status, input_json, parameter_snapshot_json,
      model_snapshot_json, prompt_version, context_provider, created_at, updated_at
    ) VALUES (?, 'interest_assessment', '11000000-0000-4000-8000-000000000001',
      'succeeded', ?, '{}', '{"provider":"openai_compatible","model":"test-model","endpointOrigin":"https://model.test"}',
      'test', 'sqlite_fts5', ?, ?)
  `)
  for (const timestamp of [100, 300, 500, 700]) {
    insertRun.run(`30000000-0000-4000-8000-${String(timestamp).padStart(12, '0')}`, JSON.stringify({ content: `运行 ${timestamp}` }), timestamp, timestamp)
  }

  const insertBatch = client.prepare(`
    INSERT INTO analysis_batches (
      id, analysis_type, world_id, persona_id, mode, baseline_soul_version_id,
      baseline_json, model_snapshot_json, parameter_snapshot_json, prompt_version,
      raw_result_json, status, created_at, updated_at
    ) VALUES (?, 'persona_memory', NULL, '10000000-0000-4000-8000-000000000001',
      'incremental', '11000000-0000-4000-8000-000000000001', '[]', '{}', '{}',
      'test', ?, 'completed', ?, ?)
  `)
  for (const timestamp of [200, 600]) {
    insertBatch.run(
      `40000000-0000-4000-8000-${String(timestamp).padStart(12, '0')}`,
      JSON.stringify({ summary: `提炼 ${timestamp}` }),
      timestamp,
      timestamp,
    )
  }
}

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-history-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  repository = new SqliteHistoryRepository(database.getClient())
  seedHistoryRecords()
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('统一任务记录分页', () => {
  it('按创建时间合并不同来源并返回准确的第二页', async () => {
    const result = await repository.listPage({ page: 2, pageSize: 5 })

    expect(result).toMatchObject({ total: 6, page: 2, pageSize: 5, totalPages: 2 })
    expect(result.items.map(item => [item.sourceType, item.createdAt])).toEqual([['run', 100]])
  })

  it('组合筛选任务类型和状态并修正越界页码', async () => {
    const result = await repository.listPage({
      page: 8,
      pageSize: 5,
      kind: 'persona_memory',
      status: 'completed',
    })

    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 5, totalPages: 1 })
    expect(result.items.map(item => item.createdAt)).toEqual([600, 200])
  })
})
