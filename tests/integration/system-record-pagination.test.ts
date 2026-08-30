import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteAuditRepository } from '../../server/infrastructure/database/SqliteAuditRepository'
import { SqliteContextIndexRepository } from '../../server/infrastructure/database/SqliteContextIndexRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'

/** 当前测试使用的临时数据目录。 */
let directory: string
/** 当前测试使用的迁移后 SQLite 数据库。 */
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-system-record-pagination-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('系统记录分页', () => {
  it('审计记录按时间倒序分页并返回准确总数', async () => {
    const insert = database.getClient().prepare(`
      INSERT INTO audit_events (id, actor, action, target_type, target_id, details_json, created_at)
      VALUES (?, 'administrator', ?, 'system', NULL, '{}', ?)
    `)
    for (let index = 1; index <= 6; index += 1) {
      insert.run(`audit-${index}`, `action-${index}`, index * 1_000)
    }

    const page = await new SqliteAuditRepository(database.getClient()).listPage({ page: 2, pageSize: 5 })

    expect(page).toMatchObject({ total: 6, page: 2, pageSize: 5, totalPages: 2 })
    expect(page.items.map(item => item.id)).toEqual(['audit-1'])
  })

  it('同步日志将越界页收敛到最后一页并稳定排序', async () => {
    const insert = database.getClient().prepare(`
      INSERT INTO context_sync_records (
        id, entity_type, source_id, scope_type, scope_id, user_id, peer_id, provider,
        remote_uri, content_hash, status, operation, error, created_at, updated_at
      ) VALUES (?, 'source_material', ?, 'world', ?, ?, NULL, 'openviking', NULL, ?, 'synchronized', 'upsert', NULL, ?, ?)
    `)
    for (let index = 1; index <= 6; index += 1) {
      insert.run(
        `sync-${index}`,
        `source-${index}`,
        `world-${index}`,
        `world-${index}`,
        String(index).repeat(64),
        index * 1_000,
        index * 1_000,
      )
    }

    const page = await new SqliteContextIndexRepository(database.getClient()).listSyncRecordsPage({ page: 9, pageSize: 5 })

    expect(page).toMatchObject({ total: 6, page: 2, pageSize: 5, totalPages: 2 })
    expect(page.items.map(item => item.id)).toEqual(['sync-1'])
  })
})
