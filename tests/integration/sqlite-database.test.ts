import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DrizzleAdministratorRepository } from '../../server/infrastructure/database/DrizzleAdministratorRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
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
      WHERE type = 'table' AND name IN ('administrators', 'openviking_sync_runtime', 'task_jobs')
      ORDER BY name
    `).all()
    expect(tables).toEqual([
      { name: 'administrators' },
      { name: 'openviking_sync_runtime' },
      { name: 'task_jobs' },
    ])
    expect(current.getClient().prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS version FROM __drizzle_migrations
    `).get()).toEqual({ count: 7, version: 1789632000000 })
    expect(current.getClient().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
      'api_keys', 'public_api_idempotency_records', 'public_api_audit_events'
    ) ORDER BY name`).all()).toEqual([
      { name: 'api_keys' },
      { name: 'public_api_audit_events' },
      { name: 'public_api_idempotency_records' },
    ])
    expect(current.getClient().prepare(`
      SELECT COUNT(*) AS count FROM ai_prompts WHERE active_version_id IS NOT NULL
    `).get()).toEqual({ count: 22 })
    expect(current.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_prompt_versions`).get()).toEqual({ count: 23 })
    expect(current.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_algorithms`).get()).toEqual({ count: 14 })
    expect(current.getClient().prepare(`SELECT code FROM ai_algorithms WHERE code = 'persona_memory'`).get()).toEqual({ code: 'persona_memory' })
    expect(current.getClient().prepare(`SELECT code FROM ai_algorithms WHERE code IN (
      'article_generation', 'article_image_analysis', 'interest_assessment'
    ) ORDER BY code`).all()).toEqual([
      { code: 'article_generation' },
      { code: 'article_image_analysis' },
      { code: 'interest_assessment' },
    ])
    expect(current.getClient().prepare(`PRAGMA table_info(generation_runs)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'algorithm_snapshot_json', notnull: 0 }),
      expect.objectContaining({ name: 'interest_algorithm_snapshot_json', notnull: 0 }),
    ]))
    expect(current.getClient().prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generation_runs'`).get())
      .toEqual(expect.objectContaining({ sql: expect.stringContaining('json_valid(`algorithm_snapshot_json`)') }))
    expect(current.getClient().prepare(`PRAGMA table_info(ai_connections)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user_agent', notnull: 1, dflt_value: "''" }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(openviking_settings)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'api_key_ciphertext', notnull: 1, dflt_value: "''" }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(source_materials)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'is_enabled', notnull: 1, dflt_value: '1' }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(personas)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'is_enabled', notnull: 1, dflt_value: '1' }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(worlds)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'is_enabled', notnull: 1, dflt_value: '1' }),
    ]))
    expect(current.getClient().prepare(`
      SELECT name FROM sqlite_master
      WHERE sql LIKE 'CREATE VIRTUAL TABLE%' OR type = 'trigger'
      ORDER BY name
    `).all()).toEqual([
      { name: 'generation_runs_task_jobs_delete' },
      { name: 'growth_records_learning_fts_delete' },
      { name: 'growth_records_learning_fts_insert' },
      { name: 'growth_records_learning_fts_update' },
      { name: 'learning_fts' },
      { name: 'memory_records_learning_fts_delete' },
      { name: 'memory_records_learning_fts_insert' },
      { name: 'memory_records_learning_fts_update' },
      { name: 'source_chunks_fts' },
      { name: 'source_chunks_fts_delete' },
      { name: 'source_chunks_fts_insert' },
      { name: 'source_chunks_fts_update' },
      { name: 'task_jobs_run_insert_check' },
      { name: 'task_jobs_run_update_check' },
    ])
  })

  it('既有 0005 数据库升级统一算法且保留历史设置和算法配置并支持重复启动', () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-sqlite-generation-upgrade-test-'))
    const dataDirectory = resolve(temporaryDirectory, 'data')
    const migrationsDirectory = resolve(temporaryDirectory, 'migrations')
    mkdirSync(resolve(migrationsDirectory, 'meta'), { recursive: true })
    for (const migration of ['0000_schema.sql', '0001_public_api_keys.sql', '0002_public_api_idempotency_audit.sql', '0003_direct_artifact_generation.sql', '0004_generation_algorithms.sql', '0005_interest_batches.sql']) {
      copyFileSync(resolve(process.cwd(), 'drizzle', migration), resolve(migrationsDirectory, migration))
    }
    writeFileSync(resolve(migrationsDirectory, 'meta', '_journal.json'), `${JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [
        { idx: 0, version: '6', when: 1789113600000, tag: '0000_schema', breakpoints: true },
        { idx: 1, version: '6', when: 1789200000000, tag: '0001_public_api_keys', breakpoints: true },
        { idx: 2, version: '6', when: 1789286400000, tag: '0002_public_api_idempotency_audit', breakpoints: true },
        { idx: 3, version: '6', when: 1789372800000, tag: '0003_direct_artifact_generation', breakpoints: true },
        { idx: 4, version: '6', when: 1789459200000, tag: '0004_generation_algorithms', breakpoints: true },
        { idx: 5, version: '6', when: 1789545600000, tag: '0005_interest_batches', breakpoints: true },
      ],
    }, null, 2)}\n`)

    database = new SqliteDatabase({ dataDirectory, migrationsDirectory })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_algorithms`).get()).toEqual({ count: 8 })
    expect(database.getClient().prepare(`PRAGMA table_info(generation_runs)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'algorithm_snapshot_json', notnull: 0 }),
    ]))
    expect(database.getClient().prepare(`PRAGMA table_info(generation_runs)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'interest_algorithm_snapshot_json', notnull: 0 }),
    ]))
    database.getClient().prepare(`
      INSERT INTO ai_connections (id, name, protocol, endpoint, api_key_ciphertext, is_enabled, created_at, updated_at)
      VALUES ('10000000-0000-4000-8000-000000000001', '旧默认接口', 'openai_compatible', 'https://model.test/v1', 'ciphertext', 1, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO ai_model_deployments (id, connection_id, name, model, modality, is_enabled, created_at, updated_at)
      VALUES ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '旧默认文本模型', 'test-model', 'text', 1, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO ai_model_deployments (id, connection_id, name, model, modality, is_enabled, created_at, updated_at)
      VALUES ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '旧默认图片模型', 'test-image-model', 'image', 1, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO system_ai_settings (id, values_json, updated_at) VALUES ('system_ai_settings', ?, 1000)
    `).run(JSON.stringify({
      textModelDeploymentId: '10000000-0000-4000-8000-000000000002',
      imageModelDeploymentId: '10000000-0000-4000-8000-000000000005',
      draftGeneration: { temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000 },
      feedbackClassification: { temperature: 0, maxOutputTokens: 4096, timeoutMs: 60000 },
    }))
    database.getClient().prepare(`
      INSERT INTO ai_algorithm_configuration_versions (id, algorithm_code, version_no, created_at)
      VALUES ('10000000-0000-4000-8000-000000000003', 'persona_soul', 1, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO ai_algorithm_step_configurations (
        id, configuration_version_id, step_key, ordinal, model_deployment_id, prompt_code, parameters_json
      ) VALUES (
        '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003',
        'organize', 0, '10000000-0000-4000-8000-000000000002', 'content.persona_soul_analysis',
        '{"temperature":0.1,"maxOutputTokens":2048,"timeoutMs":30000}'
      )
    `).run()
    database.getClient().prepare(`
      UPDATE ai_algorithms SET active_configuration_version_id = '10000000-0000-4000-8000-000000000003'
      WHERE code = 'persona_soul'
    `).run()
    database.close()
    database = null

    database = new SqliteDatabase({ dataDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_algorithms`).get()).toEqual({ count: 14 })
    expect(database.getClient().prepare(`PRAGMA table_info(generation_runs)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'algorithm_snapshot_json', notnull: 0 }),
      expect.objectContaining({ name: 'interest_algorithm_snapshot_json', notnull: 0 }),
    ]))
    expect(database.getClient().prepare(`
      SELECT ai_algorithms.active_configuration_version_id AS active_id,
        ai_algorithm_step_configurations.model_deployment_id AS deployment_id,
        ai_algorithm_step_configurations.parameters_json AS parameters_json
      FROM ai_algorithms
      INNER JOIN ai_algorithm_step_configurations
        ON ai_algorithm_step_configurations.configuration_version_id = ai_algorithms.active_configuration_version_id
      WHERE ai_algorithms.code = 'persona_draft'
    `).get()).toEqual({
      active_id: '00000000-0000-4000-8002-000000000041',
      deployment_id: '10000000-0000-4000-8000-000000000002',
      parameters_json: JSON.stringify({ temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000 }),
    })
    expect(database.getClient().prepare(`
      SELECT ai_algorithm_step_configurations.model_deployment_id AS deployment_id
      FROM ai_algorithms
      INNER JOIN ai_algorithm_step_configurations
        ON ai_algorithm_step_configurations.configuration_version_id = ai_algorithms.active_configuration_version_id
      WHERE ai_algorithms.code = 'persona_avatar'
    `).get()).toEqual({ deployment_id: '10000000-0000-4000-8000-000000000005' })
    expect(database.getClient().prepare(`
      SELECT json_type(values_json, '$.draftGeneration') AS draft_type,
        json_type(values_json, '$.feedbackClassification') AS feedback_type
      FROM system_ai_settings
    `).get()).toEqual({ draft_type: 'object', feedback_type: 'object' })
    expect(database.getClient().prepare(`
      SELECT active_configuration_version_id FROM ai_algorithms WHERE code = 'persona_soul'
    `).get()).toEqual({ active_configuration_version_id: '10000000-0000-4000-8000-000000000003' })
    expect(database.getClient().prepare(`
      SELECT COUNT(*) AS count FROM ai_algorithm_step_configurations
      WHERE configuration_version_id = '10000000-0000-4000-8000-000000000003'
    `).get()).toEqual({ count: 1 })
    expect(database.getClient().prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
    database = null

    database = new SqliteDatabase({ dataDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
    expect(database.getClient().prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS version FROM __drizzle_migrations
    `).get()).toEqual({ count: 7, version: 1789632000000 })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_algorithms`).get()).toEqual({ count: 14 })
    expect(database.getClient().prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(database.getClient().prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  })

  it('已完成压平前最终迁移的旧数据库不会重复执行新基线', () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-sqlite-legacy-test-'))
    const dataDirectory = resolve(temporaryDirectory, 'data')
    const migrationsDirectory = resolve(temporaryDirectory, 'migrations')
    mkdirSync(resolve(migrationsDirectory, 'meta'), { recursive: true })
    copyFileSync(resolve(process.cwd(), 'drizzle', '0000_schema.sql'), resolve(migrationsDirectory, '0000_schema.sql'))
    writeFileSync(resolve(migrationsDirectory, 'meta', '_journal.json'), `${JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{
        idx: 0,
        version: '6',
        when: 1789113600000,
        tag: '0000_schema',
        breakpoints: true,
      }],
    }, null, 2)}\n`)
    database = new SqliteDatabase({ dataDirectory, migrationsDirectory })
    const current = database
    const client = current.getClient()
    client.prepare(`
      INSERT INTO source_materials (
        id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
      ) VALUES ('source-1', '旧资料', 'reference', 'paste', ?, '压平前正文。', NULL, 1000, 1000)
    `).run('a'.repeat(64))
    client.prepare(`
      INSERT INTO context_sync_records (
        id, entity_type, source_id, scope_type, scope_id, user_id, provider,
        content_hash, status, operation, error, created_at, updated_at
      ) VALUES (
        'sync-1', 'source_material', 'source-1', 'persona', 'persona-1', 'user-1', 'openviking',
        ?, 'failed', 'upsert', '旧同步错误', 1000, 1000
      )
    `).run('b'.repeat(64))
    // 以当前真实表结构配合十六条历史记录，模拟从最早迁移链升级到 0006 的现有数据库。
    client.prepare(`DELETE FROM __drizzle_migrations`).run()
    const insertMigration = client.prepare(`
      INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)
    `)
    const versions = [
      1788028900254,
      1788036380272,
      1788042164727,
      1788075317577,
      1788081200000,
      1788084800000,
      1788163200000,
      1788249600000,
      1788336000000,
      1788422400000,
      1788508800000,
      1788768000000,
      1788854400000,
      1788940800000,
      1789027200000,
      1789113600000,
    ]
    versions.forEach((version, index) => insertMigration.run(`legacy-${index}`, version))
    current.close()
    database = null

    database = new SqliteDatabase({
      dataDirectory,
      migrationsDirectory: resolve(process.cwd(), 'drizzle'),
    })
    expect(database.getClient().prepare(`
      SELECT name, content_text, is_enabled FROM source_materials WHERE id = 'source-1'
    `).get()).toEqual({ name: '旧资料', content_text: '压平前正文。', is_enabled: 1 })
    expect(database.getClient().prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS version FROM __drizzle_migrations
    `).get()).toEqual({ count: 22, version: 1789632000000 })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_algorithms`).get()).toEqual({ count: 14 })
    expect(database.getClient().prepare(`PRAGMA table_info(generation_runs)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'algorithm_snapshot_json', notnull: 0 }),
      expect.objectContaining({ name: 'interest_algorithm_snapshot_json', notnull: 0 }),
    ]))
    expect(database.getClient().prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'openviking_sync_runtime'`).get()).toEqual({ name: 'openviking_sync_runtime' })
    expect(database.getClient().prepare(`
      SELECT error, error_code, error_stage, failure_count, next_retry_at
      FROM context_sync_records WHERE id = 'sync-1'
    `).get()).toEqual({
      error: '旧同步错误',
      error_code: null,
      error_stage: null,
      failure_count: 0,
      next_retry_at: null,
    })
    expect(database.getClient().prepare(`PRAGMA table_info(ai_connections)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user_agent', notnull: 1, dflt_value: "''" }),
    ]))
    expect(database.getClient().prepare(`PRAGMA table_info(openviking_settings)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'api_key_ciphertext', notnull: 1, dflt_value: "''" }),
    ]))
    expect(database.getClient().prepare('PRAGMA foreign_key_check').all()).toEqual([])
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
      VALUES (?, ?, '{}', ?, 0, 2, 1_000, 1_000)
    `)
    insert.run('queued-job', 'assess_interest', 'queued')
    insert.run('internal-queued-job', 'sync_context_source', 'queued')
    insert.run('running-job', 'assess_interest', 'running')
    insert.run('cancel-requested-job', 'assess_interest', 'cancel_requested')
    insert.run('succeeded-job', 'assess_interest', 'succeeded')
    insert.run('failed-job', 'assess_interest', 'failed')

    await expect(new SqliteTaskJobRepository(client).getPendingSummary()).resolves.toEqual({
      userQueued: 1,
      queued: 2,
      running: 1,
      cancelRequested: 1,
      total: 4,
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

})
