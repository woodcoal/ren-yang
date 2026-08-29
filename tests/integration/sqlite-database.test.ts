import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DrizzleAdministratorRepository } from '../../server/infrastructure/database/DrizzleAdministratorRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteRunRepository } from '../../server/infrastructure/database/SqliteRunRepository'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'

/** 每个测试创建的数据目录，结束后只清理自身目录。 */
let temporaryDirectory: string | null = null
/** 当前测试打开的数据库。 */
let database: SqliteDatabase | null = null

/**
 * 创建迁移完成的独立 SQLite 数据库。
 * @returns 已初始化数据库。
 */
function createDatabase(): SqliteDatabase {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-sqlite-test-'))
  database = new SqliteDatabase({
    dataDirectory: temporaryDirectory,
    migrationsDirectory: resolve(process.cwd(), 'drizzle'),
  })
  return database
}

/**
 * 创建只包含阶段四迁移的目录，用于验证真实增量升级。
 * @param root 测试独占根目录。
 * @returns 旧迁移目录绝对路径。
 */
function createStageFourMigrations(root: string): string {
  const migrations = resolve(root, 'old-migrations')
  const metadata = resolve(migrations, 'meta')
  mkdirSync(metadata, { recursive: true })
  for (const name of ['0000_initial_foundation.sql', '0001_jazzy_rage.sql', '0002_premium_nocturne.sql', '0003_image-artifacts.sql']) {
    copyFileSync(resolve(process.cwd(), 'drizzle', name), resolve(migrations, name))
  }
  const journal = JSON.parse(readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8')) as {
    version: string
    dialect: string
    entries: Array<{ idx: number }>
  }
  writeFileSync(resolve(metadata, '_journal.json'), JSON.stringify({
    ...journal,
    entries: journal.entries.filter(entry => entry.idx <= 3),
  }))
  return migrations
}

afterEach(() => {
  database?.close()
  database = null
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = null
  }
})

describe('SqliteDatabase', () => {
  it('从空目录迁移并启用 WAL、外键和完整性检查', async () => {
    const current = createDatabase()

    await expect(current.check()).resolves.toMatchObject({
      healthy: true,
      journalMode: 'wal',
      foreignKeysEnabled: true,
      integrity: 'ok',
    })

    const tables = current.getClient().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('administrators', 'task_jobs')
      ORDER BY name
    `).all()
    expect(tables).toEqual([{ name: 'administrators' }, { name: 'task_jobs' }])
  })

  it('数据库唯一约束阻止创建第二名管理员', async () => {
    const current = createDatabase()
    const repository = new DrizzleAdministratorRepository(current.db)
    const record = {
      id: 'administrator',
      username: 'admin',
      passwordHash: 'hash',
      credentialVersion: 1,
      timestamp: 1_000,
    }

    await expect(repository.createIfAbsent(record)).resolves.toBe(true)
    await expect(repository.createIfAbsent(record)).resolves.toBe(false)
    await expect(repository.updatePassword('administrator', 'new-hash', 2_000)).resolves.toMatchObject({
      credentialVersion: 2,
      passwordHash: 'new-hash',
      updatedAt: 2_000,
    })
  })

  it('原子领取任务并增加尝试次数和租约', async () => {
    const current = createDatabase()
    const client = current.getClient()
    client.prepare(`
      INSERT INTO task_jobs (id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', 0, 2, ?, ?)
    `).run('job-1', 'test', '{}', 1_000, 1_000)
    const repository = new SqliteTaskJobRepository(client)

    await expect(repository.claimNext(2_000, 60_000)).resolves.toMatchObject({
      id: 'job-1',
      status: 'running',
      attemptCount: 1,
      leaseUntil: 62_000,
    })
    await expect(repository.claimNext(2_000, 60_000)).resolves.toBeNull()
  })

  it('任务队列摘要只统计仍需 Worker 处理的任务', async () => {
    const current = createDatabase()
    const client = current.getClient()
    const insert = client.prepare(`
      INSERT INTO task_jobs (id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
      VALUES (?, 'test', '{}', ?, 0, 2, 1_000, 1_000)
    `)
    insert.run('queued-job', 'queued')
    insert.run('running-job', 'running')
    insert.run('cancel-requested-job', 'cancel_requested')
    insert.run('succeeded-job', 'succeeded')
    insert.run('failed-job', 'failed')

    await expect(new SqliteTaskJobRepository(client).getPendingSummary()).resolves.toEqual({
      queued: 1,
      running: 1,
      cancelRequested: 1,
      total: 3,
    })
  })

  it('按最大尝试次数恢复或终止过期租约', async () => {
    const current = createDatabase()
    const client = current.getClient()
    const insert = client.prepare(`
      INSERT INTO task_jobs (
        id, type, status, attempt_count, max_attempts, lease_until, heartbeat_at, created_at, updated_at
      ) VALUES (?, 'test', 'running', ?, 2, 1_000, 900, 500, 900)
    `)
    insert.run('retry-job', 1)
    insert.run('failed-job', 2)
    const repository = new SqliteTaskJobRepository(client)

    await expect(repository.recoverExpired(2_000)).resolves.toBe(2)
    expect(client.prepare('SELECT id, status FROM task_jobs ORDER BY id').all()).toEqual([
      { id: 'failed-job', status: 'failed' },
      { id: 'retry-job', status: 'queued' },
    ])
  })

  it('执行失败时只在可重试且尚有次数时重新排队', async () => {
    const current = createDatabase()
    const client = current.getClient()
    client.prepare(`
      INSERT INTO task_jobs (id, type, status, attempt_count, max_attempts, created_at, updated_at)
      VALUES ('job-retry', 'test', 'queued', 0, 2, 500, 500)
    `).run()
    const repository = new SqliteTaskJobRepository(client)

    await repository.claimNext(1_000, 100)
    await expect(repository.markFailed('job-retry', '临时失败', 1_001, true)).resolves.toBe(true)
    expect(client.prepare(`SELECT status, attempt_count FROM task_jobs WHERE id = 'job-retry'`).get())
      .toEqual({ status: 'queued', attempt_count: 1 })

    await repository.claimNext(2_000, 100)
    await expect(repository.markFailed('job-retry', '再次失败', 2_001, true)).resolves.toBe(false)
    expect(client.prepare(`SELECT status, attempt_count FROM task_jobs WHERE id = 'job-retry'`).get())
      .toEqual({ status: 'failed', attempt_count: 2 })
  })

  it('从阶段四数据库升级后保留人物、运行和图片资产且新增业务表为空', async () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-sqlite-upgrade-test-'))
    const oldMigrations = createStageFourMigrations(temporaryDirectory)
    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: oldMigrations })
    const client = database.getClient()
    client.prepare(`INSERT INTO personas (id, name, origin, created_at, updated_at) VALUES ('persona-1', '林默', 'original', 1000, 1000)`).run()
    client.prepare(`
      INSERT INTO persona_versions (id, persona_id, status, snapshot_json, change_summary, published_at, created_at)
      VALUES ('version-1', 'persona-1', 'published', '{}', '初始版本', 1000, 1000)
    `).run()
    client.prepare(`
      INSERT INTO generation_runs (
        id, kind, persona_version_id, status, input_json, parameter_snapshot_json,
        model_snapshot_json, prompt_version, context_provider, created_at, updated_at, completed_at
      ) VALUES ('run-1', 'artifact_generation', 'version-1', 'succeeded', '{"requirement":"测试"}',
        '{"temperature":0.4,"maxOutputTokens":2048,"timeoutMs":60000,"maxEvidenceChunks":8,"maxTextBlocks":12}',
        '{"provider":"openai_compatible","model":"test","endpointOrigin":"https://model.test"}',
        'text-v1', 'sqlite_fts5', 1000, 2000, 2000)
    `).run()
    client.prepare(`
      INSERT INTO document_specs (id, run_id, revision, status, spec_json, confirmed_at, created_at)
      VALUES ('spec-1', 'run-1', 1, 'confirmed',
        '{"title":"标题","summary":"摘要","blocks":[{"key":"body","role":"paragraph","instruction":"正文","acceptanceCriteria":["准确"],"dependsOn":[]}]}',
        1100, 1000)
    `).run()
    client.prepare(`INSERT INTO artifact_documents (id, run_id, selected_spec_id, created_at, updated_at) VALUES ('document-1', 'run-1', 'spec-1', 1100, 2000)`).run()
    client.prepare(`
      INSERT INTO artifact_blocks (
        id, document_id, spec_key, ordinal, type, role, spec_json, status,
        selected_attempt_id, is_locked, created_at, updated_at
      ) VALUES ('block-1', 'document-1', 'body', 0, 'text', 'paragraph',
        '{"key":"body","role":"paragraph","instruction":"正文","acceptanceCriteria":["准确"],"dependsOn":[]}',
        'succeeded', 'attempt-1', 1, 1100, 2000)
    `).run()
    client.prepare(`
      INSERT INTO block_attempts (
        id, block_id, attempt_no, status, input_snapshot_json, output_text, usage_json, created_at, completed_at
      ) VALUES ('attempt-1', 'block-1', 1, 'succeeded', '{}', '旧版正文', '{}', 1200, 2000)
    `).run()
    client.prepare(`
      INSERT INTO image_assets (
        id, attempt_id, relative_path, media_type, size_bytes, content_hash, alt_text, created_at
      ) VALUES ('asset-1', 'attempt-1', 'assets/asset-1.png', 'image/png', 1024, ?, '旧版图片', 2000)
    `).run('a'.repeat(64))
    database.close()

    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
    const upgraded = database.getClient()
    expect(upgraded.prepare(`SELECT type, status, selected_attempt_id, is_locked, selected_at, locked_at FROM artifact_blocks WHERE id = 'block-1'`).get()).toEqual({
      type: 'text', status: 'succeeded', selected_attempt_id: 'attempt-1', is_locked: 1, selected_at: null, locked_at: null,
    })
    expect(upgraded.prepare(`SELECT status, output_text FROM block_attempts WHERE id = 'attempt-1'`).get()).toEqual({ status: 'succeeded', output_text: '旧版正文' })
    expect(upgraded.prepare(`SELECT id, relative_path, alt_text FROM image_assets WHERE id = 'asset-1'`).get()).toEqual({
      id: 'asset-1', relative_path: 'assets/asset-1.png', alt_text: '旧版图片',
    })
    expect(upgraded.prepare(`SELECT id, name, active_version_id FROM personas WHERE id = 'persona-1'`).get()).toEqual({
      id: 'persona-1', name: '林默', active_version_id: null,
    })
    expect(upgraded.prepare(`SELECT id, status FROM generation_runs WHERE id = 'run-1'`).get()).toEqual({ id: 'run-1', status: 'succeeded' })
    await expect(new SqliteRunRepository(upgraded).findRun('run-1')).resolves.toMatchObject({
      parameterSnapshot: {
        maxImageBlocks: 4,
        maxPromptCharacters: 120_000,
        maxTotalTokens: 50_000,
        maxBlockAttempts: 2,
      },
    })
    const newTables = [
      'feedback_events',
      'feedback_suggestions',
      'feedback_resolutions',
      'revision_proposals',
      'candidate_memories',
      'evaluation_cases',
      'evaluation_runs',
      'evaluation_results',
      'context_sync_records',
    ]
    for (const table of newTables) {
      expect(upgraded.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), `${table} 应为空`).toEqual({ count: 0 })
    }
    expect(upgraded.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
  })
})
