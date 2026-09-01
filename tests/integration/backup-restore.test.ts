import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../../server/application/backup/BackupApplicationService'
import { LocalBackupManager } from '../../server/infrastructure/backup/LocalBackupManager'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { ApplicationInstanceLock } from '../../server/infrastructure/system/ApplicationInstanceLock'
import type { CompatibleBackupManifest, LegacyBackupManifest } from '../../shared/types/backup'

/** 测试使用的稳定 UUID。 */
const IDS = {
  source: '00000000-0000-4000-8000-000000000001',
  chunk: '00000000-0000-4000-8000-000000000002',
  persona: '00000000-0000-4000-8000-000000000003',
  version: '00000000-0000-4000-8000-000000000004',
  run: '00000000-0000-4000-8000-000000000005',
  spec: '00000000-0000-4000-8000-000000000006',
  document: '00000000-0000-4000-8000-000000000007',
  block: '00000000-0000-4000-8000-000000000008',
  attempt: '00000000-0000-4000-8000-000000000009',
  asset: '00000000-0000-4000-8000-000000000010',
  sync: '00000000-0000-4000-8000-000000000011',
} as const

/** 资料原文件内容。 */
const SOURCE_BYTES = Buffer.from('# 魔法学院\n档案保存于北塔。', 'utf8')
/** 最小 PNG 文件头和测试正文。 */
const IMAGE_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])

let rootDirectory: string
let dataDirectory: string
let database: SqliteDatabase
let service: BackupApplicationService

beforeEach(() => {
  rootDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-backup-test-'))
  dataDirectory = resolve(rootDirectory, 'data')
  database = new SqliteDatabase({ dataDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  database.getClient().pragma('wal_autocheckpoint = 0')
  seedReferencedData()
  service = new BackupApplicationService(new LocalBackupManager(dataDirectory, resolve(process.cwd(), 'drizzle')))
})

afterEach(() => {
  database.close()
  rmSync(rootDirectory, { recursive: true, force: true })
})

describe('SQLite 与引用文件备份恢复', () => {
  it('从活动 WAL 创建一致性备份，并只收录数据库实际引用的受控文件', async () => {
    writeFileSync(resolve(dataDirectory, 'secret.env'), 'MODEL_API_KEY=不得备份')
    writeFileSync(resolve(dataDirectory, 'logs', 'application.log'), '不得备份日志')
    mkdirSync(resolve(dataDirectory, 'openviking'), { recursive: true })
    writeFileSync(resolve(dataDirectory, 'openviking', 'token'), '不得备份外部索引')
    writeFileSync(resolve(dataDirectory, 'sources', 'unreferenced.txt'), '未引用文件')
    expect(existsSync(resolve(dataDirectory, 'app.sqlite-wal'))).toBe(true)

    const backupDirectory = await service.create()
    const validation = await service.validate(backupDirectory)
    const paths = validation.manifest.files.map(file => file.path)

    expect(paths).toEqual([
      'app.sqlite',
      `artifacts/${IDS.run}/assets/${IDS.asset}.png`,
      `sources/${IDS.source}.md`,
    ])
    expect(validation.fileCount).toBe(3)
    expect(validation.manifest.version).toBe(2)
    if (validation.manifest.version !== 2) throw new Error('新建备份应使用第二版清单')
    expect(validation.manifest.migrationVersion).toBe(1789372800000)
    expect(existsSync(resolve(backupDirectory, 'app.sqlite-wal'))).toBe(false)
    expect(existsSync(resolve(backupDirectory, 'app.sqlite-shm'))).toBe(false)
    for (const file of validation.manifest.files) {
      const bytes = readFileSync(resolve(backupDirectory, file.path))
      expect(file.sizeBytes).toBe(bytes.byteLength)
      expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
    expect(JSON.stringify(validation.manifest)).not.toContain('MODEL_API_KEY')
    expect(paths.some(path => path.includes('logs') || path.includes('openviking') || path.includes('unreferenced'))).toBe(false)
  })

  it('拒绝被篡改的文件和包含路径穿越的清单', async () => {
    const backupDirectory = await service.create()
    const manifestPath = resolve(backupDirectory, 'manifest.json')
    const original = readManifest(manifestPath)
    const sourcePath = resolve(backupDirectory, `sources/${IDS.source}.md`)

    writeFileSync(sourcePath, '已被篡改')
    await expect(service.validate(backupDirectory)).rejects.toThrow('备份文件大小或哈希不一致')

    writeFileSync(sourcePath, SOURCE_BYTES)
    original.files[0]!.path = '../app.sqlite'
    writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`)
    await expect(service.validate(backupDirectory)).rejects.toThrow('备份清单包含不受控路径')
  })

  it('拒绝未列入清单的额外文件', async () => {
    const backupDirectory = await service.create()
    writeFileSync(resolve(backupDirectory, 'secret.env'), '不得夹带')
    await expect(service.validate(backupDirectory)).rejects.toThrow('备份目录包含未列入清单的额外文件')
  })

  it('允许压平前已到达当前最终结构的十六步数据库备份', async () => {
    const backupDirectory = await service.create()
    const databasePath = resolve(backupDirectory, 'app.sqlite')
    const previousDatabase = new Database(databasePath, { fileMustExist: true })
    try {
      previousDatabase.prepare(`DELETE FROM __drizzle_migrations`).run()
      const insertMigration = previousDatabase.prepare(`
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
      versions.forEach((version, index) => insertMigration.run(`previous-current-${index}`, version))
    }
    finally {
      previousDatabase.close()
    }

    const manifestPath = resolve(backupDirectory, 'manifest.json')
    const manifest = readManifest(manifestPath)
    const databaseFile = manifest.files.find(file => file.path === 'app.sqlite')
    if (!databaseFile) throw new Error('备份清单缺少 app.sqlite')
    const databaseBytes = readFileSync(databasePath)
    databaseFile.sizeBytes = databaseBytes.byteLength
    databaseFile.sha256 = hash(databaseBytes)
    manifest.migrationVersion = 1789113600000
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(service.validate(backupDirectory)).resolves.toMatchObject({
      manifest: { version: 2, migrationVersion: 1789113600000 },
    })
  })

  it('拒绝恢复未到达当前最终结构的十步迁移备份', async () => {
    const backupDirectory = await service.create()
    const databasePath = resolve(backupDirectory, 'app.sqlite')
    const legacyDatabase = new Database(databasePath, { fileMustExist: true })
    try {
      legacyDatabase.prepare(`DELETE FROM __drizzle_migrations`).run()
      const insertMigration = legacyDatabase.prepare(`
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
      ]
      versions.forEach((version, index) => insertMigration.run(`legacy-${index}`, version))
    }
    finally {
      legacyDatabase.close()
    }

    const manifestPath = resolve(backupDirectory, 'manifest.json')
    const currentManifest = readManifest(manifestPath)
    if (currentManifest.version !== 2) throw new Error('新建备份应使用第二版清单')
    const { migrationVersion: _migrationVersion, ...sharedManifest } = currentManifest
    const legacyManifest: LegacyBackupManifest = {
      ...sharedManifest,
      version: 1,
      migrationCount: 10,
    }
    const databaseFile = legacyManifest.files.find(file => file.path === 'app.sqlite')
    if (!databaseFile) throw new Error('备份清单缺少 app.sqlite')
    const databaseBytes = readFileSync(databasePath)
    databaseFile.sizeBytes = databaseBytes.byteLength
    databaseFile.sha256 = hash(databaseBytes)
    writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`)

    await expect(service.validate(backupDirectory)).rejects.toThrow('备份迁移版本与当前程序不兼容')
  })

  it('拒绝恢复 OpenViking 韧性迁移前生成的中间版备份', async () => {
    const backupDirectory = await service.create()
    const databasePath = resolve(backupDirectory, 'app.sqlite')
    const previousDatabase = new Database(databasePath, { fileMustExist: true })
    try {
      previousDatabase.prepare(`DELETE FROM __drizzle_migrations WHERE created_at > ?`).run(1788854400000)
    }
    finally {
      previousDatabase.close()
    }

    const manifestPath = resolve(backupDirectory, 'manifest.json')
    const manifest = readManifest(manifestPath)
    if (manifest.version !== 2) throw new Error('新建备份应使用第二版清单')
    manifest.migrationVersion = 1788854400000
    const databaseFile = manifest.files.find(file => file.path === 'app.sqlite')
    if (!databaseFile) throw new Error('备份清单缺少 app.sqlite')
    const databaseBytes = readFileSync(databasePath)
    databaseFile.sizeBytes = databaseBytes.byteLength
    databaseFile.sha256 = hash(databaseBytes)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(service.validate(backupDirectory)).rejects.toThrow('备份迁移版本与当前程序不兼容')
  })

  it('引用文件缺失时创建失败并清理未完成备份目录', async () => {
    rmSync(resolve(dataDirectory, `sources/${IDS.source}.md`))

    await expect(service.create()).rejects.toThrow()
    expect(readdirSync(resolve(dataDirectory, 'backups')).filter(name => name.startsWith('.'))).toEqual([])
  })

  it('停机恢复保留旧目录、撤销会话、重建 FTS 并标记 OpenViking 待重建', async () => {
    database.getClient().prepare(`INSERT INTO source_chunks_fts(source_chunks_fts) VALUES ('delete-all')`).run()
    const backupDirectory = await service.create()
    database.getClient().prepare(`UPDATE administrators SET credential_version = 9`).run()
    writeFileSync(resolve(dataDirectory, `sources/${IDS.source}.md`), '备份后的错误内容')
    database.close()

    const result = await service.restore(backupDirectory)
    const restored = new Database(resolve(dataDirectory, 'app.sqlite'), { readonly: true, fileMustExist: true })
    try {
      expect(readFileSync(resolve(dataDirectory, `sources/${IDS.source}.md`))).toEqual(SOURCE_BYTES)
      expect(restored.prepare(`SELECT credential_version FROM administrators WHERE id = 'administrator'`).get()).toEqual({ credential_version: 5 })
      expect(restored.prepare(`SELECT status, error FROM context_sync_records WHERE id = ?`).get(IDS.sync)).toEqual({
        status: 'pending',
        error: '数据恢复后需要全量重建 OpenViking 索引',
      })
      expect(restored.prepare(`SELECT COUNT(*) AS count FROM source_chunks_fts WHERE source_chunks_fts MATCH '魔法学院'`).get()).toEqual({ count: 1 })
      expect(restored.prepare(`SELECT actor, action, target_id FROM audit_events WHERE action = 'data_restored'`).get()).toEqual({
        actor: 'maintenance',
        action: 'data_restored',
        target_id: result.backupId,
      })
    }
    finally {
      restored.close()
    }
    expect(existsSync(result.rollbackDirectory)).toBe(true)
    expect(readFileSync(resolve(result.rollbackDirectory, `sources/${IDS.source}.md`), 'utf8')).toBe('备份后的错误内容')
    expect(resolve(result.rollbackDirectory).startsWith(`${rootDirectory}/data.rollback-`)).toBe(true)
  })

  it('活动应用实例存在时拒绝恢复且不改变当前数据', async () => {
    const backupDirectory = await service.create()
    writeFileSync(resolve(dataDirectory, 'current-marker.txt'), '当前数据')
    const lock = new ApplicationInstanceLock(dataDirectory)
    try {
      expect(() => new ApplicationInstanceLock(dataDirectory)).toThrow('该数据目录已有运行中的人样进程')
      await expect(service.restore(backupDirectory)).rejects.toThrow('应用仍在运行')
      expect(readFileSync(resolve(dataDirectory, 'current-marker.txt'), 'utf8')).toBe('当前数据')
    }
    finally {
      lock.release()
    }
  })

  it('开发热更新允许同一 PID 临时重入且最后一个实例释放前保持锁有效', () => {
    const first = new ApplicationInstanceLock(dataDirectory, { allowSameProcessReentry: true })
    const second = new ApplicationInstanceLock(dataDirectory, { allowSameProcessReentry: true })

    first.release()
    expect(ApplicationInstanceLock.isActive(dataDirectory)).toBe(true)
    second.release()
    expect(ApplicationInstanceLock.isActive(dataDirectory)).toBe(false)
  })

  it('恢复前验证失败时不覆盖当前数据目录', async () => {
    const backupDirectory = await service.create()
    writeFileSync(resolve(dataDirectory, 'current-marker.txt'), '当前数据')
    writeFileSync(resolve(backupDirectory, `artifacts/${IDS.run}/assets/${IDS.asset}.png`), '损坏')
    database.close()

    await expect(service.restore(backupDirectory)).rejects.toThrow('备份文件大小或哈希不一致')
    expect(readFileSync(resolve(dataDirectory, 'current-marker.txt'), 'utf8')).toBe('当前数据')
    expect(existsSync(resolve(dataDirectory, 'app.sqlite'))).toBe(true)
  })
})

/**
 * 写入覆盖资料、图片、管理员会话和 OpenViking 状态的最小合法数据集。
 * @returns 数据和引用文件写入完成时结束。
 */
function seedReferencedData(): void {
  const client = database.getClient()
  mkdirSync(resolve(dataDirectory, 'sources'), { recursive: true })
  mkdirSync(resolve(dataDirectory, 'artifacts', IDS.run, 'assets'), { recursive: true })
  writeFileSync(resolve(dataDirectory, `sources/${IDS.source}.md`), SOURCE_BYTES)
  writeFileSync(resolve(dataDirectory, `artifacts/${IDS.run}/assets/${IDS.asset}.png`), IMAGE_BYTES)

  client.prepare(`
    INSERT INTO administrators (id, username, password_hash, credential_version, created_at, updated_at)
    VALUES ('administrator', 'admin', 'test-hash', 4, 1000, 1000)
  `).run()
  client.prepare(`
    INSERT INTO source_materials (
      id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
    ) VALUES (?, '学院档案', 'canon_fact', 'markdown', ?, '魔法学院档案保存于北塔。', ?, 1000, 1000)
  `).run(IDS.source, hash(SOURCE_BYTES), `sources/${IDS.source}.md`)
  client.prepare(`
    INSERT INTO source_chunks (id, source_id, ordinal, heading, content, content_hash)
    VALUES (?, ?, 0, '魔法学院', '魔法学院档案保存于北塔。', ?)
  `).run(IDS.chunk, IDS.source, hash('魔法学院档案保存于北塔。'))
  client.prepare(`
    INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
    VALUES (?, NULL, '档案员', 'original', ?, 1000, 1000)
  `).run(IDS.persona, IDS.version)
  client.prepare(`
    INSERT INTO soul_versions (
      id, subject_type, world_id, persona_id, parent_version_id, prompt_text,
      runtime_token_count, token_counter, change_summary, status, published_at, created_at
    ) VALUES (?, 'persona', NULL, ?, NULL, ?, 12, 'test', '初始版本', 'published', 1000, 1000)
  `).run(IDS.version, IDS.persona, '谨慎的学院档案员。')
  client.prepare(`
    INSERT INTO generation_runs (
      id, kind, persona_version_id, status, input_json, parameter_snapshot_json, model_snapshot_json,
      image_model_snapshot_json, prompt_version, context_provider, prompt_context_snapshot_json,
      created_at, updated_at, completed_at
    ) VALUES (?, 'artifact_generation', ?, 'succeeded', '{}', '{}', '{}', '{}', 'artifact-v5', 'sqlite_fts5', NULL, 1000, 1000, 1000)
  `).run(IDS.run, IDS.version)
  client.prepare(`
    INSERT INTO document_specs (id, run_id, revision, status, spec_json, confirmed_at, created_at)
    VALUES (?, ?, 1, 'confirmed', '{}', 1000, 1000)
  `).run(IDS.spec, IDS.run)
  client.prepare(`
    INSERT INTO artifact_documents (id, run_id, selected_spec_id, created_at, updated_at)
    VALUES (?, ?, ?, 1000, 1000)
  `).run(IDS.document, IDS.run, IDS.spec)
  client.prepare(`
    INSERT INTO artifact_blocks (
      id, document_id, spec_key, ordinal, type, role, spec_json, status, selected_attempt_id,
      is_locked, selected_at, created_at, updated_at
    ) VALUES (?, ?, 'hero', 0, 'image', 'hero_image', '{}', 'succeeded', ?, 0, 1000, 1000, 1000)
  `).run(IDS.block, IDS.document, IDS.attempt)
  client.prepare(`
    INSERT INTO block_attempts (id, block_id, attempt_no, status, input_snapshot_json, created_at, completed_at)
    VALUES (?, ?, 1, 'succeeded', '{}', 1000, 1000)
  `).run(IDS.attempt, IDS.block)
  client.prepare(`
    INSERT INTO image_assets (id, attempt_id, relative_path, media_type, size_bytes, content_hash, alt_text, created_at)
    VALUES (?, ?, ?, 'image/png', ?, ?, '学院主图', 1000)
  `).run(IDS.asset, IDS.attempt, `assets/${IDS.asset}.png`, IMAGE_BYTES.byteLength, hash(IMAGE_BYTES))
  client.prepare(`
    INSERT INTO context_sync_records (
      id, entity_type, source_id, scope_type, scope_id, user_id, peer_id,
      provider, remote_uri, content_hash, status, operation, error, created_at, updated_at
    ) VALUES (?, 'source_material', ?, 'persona', ?, ?, ?, 'openviking', 'viking://~/peers/persona-test/resources/ren-yang/test.md', ?, 'synchronized', 'upsert', NULL, 1000, 1000)
  `).run(IDS.sync, IDS.source, IDS.persona, `standalone-${IDS.persona}`, `persona-${IDS.persona}`, hash(SOURCE_BYTES))
}

/**
 * 读取测试备份清单。
 * @param path 清单文件绝对路径。
 * @returns 解析后的备份清单。
 */
function readManifest(path: string): CompatibleBackupManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as CompatibleBackupManifest
}

/**
 * 计算测试数据的 SHA-256。
 * @param value UTF-8 文本或原始字节。
 * @returns 小写十六进制哈希。
 */
function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
