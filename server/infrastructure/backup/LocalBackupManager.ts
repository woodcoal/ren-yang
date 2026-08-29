import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, posix, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import type { BackupManifest, BackupManifestFile, BackupRestoreResult, BackupValidationResult } from '../../../shared/types/backup'
import type { BackupPort } from '../../ports/BackupPort'
import { ApplicationInstanceLock } from '../system/ApplicationInstanceLock'
import { insertAuditEvent } from '../database/AuditSql'

/** 当前备份清单文件名。 */
const MANIFEST_NAME = 'manifest.json'
/** 备份内固定数据库文件名。 */
const DATABASE_NAME = 'app.sqlite'
/** 允许进入备份的受控相对路径。 */
const FILE_PATH_PATTERN = /^(sources\/[0-9a-f-]{36}\.(txt|md)|artifacts\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}\.(png|jpg|webp))$/i

/** 使用 SQLite 在线备份和逐文件哈希实现本地可恢复备份。 */
export class LocalBackupManager implements BackupPort {
  /** 数据目录绝对路径。 */
  private readonly dataDirectory: string
  /** 迁移日志中的当前迁移数量。 */
  private readonly migrationCount: number

  /**
   * 创建本地备份管理器。
   * @param dataDirectory 当前应用数据目录。
   * @param migrationsDirectory 当前 Drizzle 迁移目录。
   */
  constructor(dataDirectory: string, migrationsDirectory: string) {
    this.dataDirectory = absolute(dataDirectory)
    this.migrationCount = readMigrationCount(absolute(migrationsDirectory))
  }

  /** @returns 原子完成的新备份目录绝对路径。 */
  async create(): Promise<string> {
    const backupId = `backup-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`
    const backupRoot = resolve(this.dataDirectory, 'backups')
    const pending = resolve(backupRoot, `.${backupId}.pending`)
    const completed = resolve(backupRoot, backupId)
    await mkdir(backupRoot, { recursive: true })
    await mkdir(pending, { recursive: false })
    try {
      const source = new Database(resolve(this.dataDirectory, DATABASE_NAME), { readonly: true, fileMustExist: true })
      try {
        await source.backup(resolve(pending, DATABASE_NAME))
      }
      finally {
        source.close()
      }
      await normalizeBackupDatabase(resolve(pending, DATABASE_NAME))
      const references = inspectDatabase(resolve(pending, DATABASE_NAME), this.migrationCount)
      const files: BackupManifestFile[] = [await describeFile(resolve(pending, DATABASE_NAME), DATABASE_NAME, 'application/vnd.sqlite3')]
      for (const [relativePath, mediaType] of references) {
        const sourcePath = resolveControlled(this.dataDirectory, relativePath)
        await assertRegularFile(sourcePath)
        const targetPath = resolveControlled(pending, relativePath)
        await mkdir(dirname(targetPath), { recursive: true })
        await copyFile(sourcePath, targetPath)
        files.push(await describeFile(targetPath, relativePath, mediaType))
      }
      const manifest: BackupManifest = {
        version: 1,
        backupId,
        createdAt: new Date().toISOString(),
        migrationCount: this.migrationCount,
        files: files.sort((left, right) => left.path.localeCompare(right.path)),
      }
      await writeFile(resolve(pending, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      await this.validate(pending)
      await rename(pending, completed)
      return completed
    }
    catch (error: unknown) {
      await rm(pending, { recursive: true, force: true })
      throw error
    }
  }

  /** @param backupDirectory 备份目录。 @returns 不修改任何文件的完整验证结果。 */
  async validate(backupDirectory: string): Promise<BackupValidationResult> {
    const root = absolute(backupDirectory)
    const manifestPath = resolve(root, MANIFEST_NAME)
    await assertRegularFile(manifestPath)
    const manifest = parseManifest(await readFile(manifestPath, 'utf8'))
    if (manifest.migrationCount !== this.migrationCount) throw new Error('备份迁移版本与当前程序不兼容')
    const paths = new Set<string>()
    let totalBytes = 0
    for (const file of manifest.files) {
      assertManifestPath(file.path)
      if (paths.has(file.path)) throw new Error(`备份清单包含重复路径：${file.path}`)
      paths.add(file.path)
      const actual = await describeFile(resolveControlled(root, file.path), file.path, file.mediaType)
      if (actual.sizeBytes !== file.sizeBytes || actual.sha256 !== file.sha256) {
        throw new Error(`备份文件大小或哈希不一致：${file.path}`)
      }
      totalBytes += actual.sizeBytes
    }
    if (!paths.has(DATABASE_NAME)) throw new Error('备份清单缺少 app.sqlite')
    const actualPaths = new Set(await listBackupFiles(root))
    const declaredPaths = new Set([MANIFEST_NAME, ...paths])
    if (actualPaths.size !== declaredPaths.size || [...actualPaths].some(path => !declaredPaths.has(path))) {
      throw new Error('备份目录包含未列入清单的额外文件')
    }
    const references = inspectDatabase(resolve(root, DATABASE_NAME), this.migrationCount)
    const expectedMediaTypes = new Map([[DATABASE_NAME, 'application/vnd.sqlite3'], ...references.entries()])
    const expected = new Set(expectedMediaTypes.keys())
    if (expected.size !== paths.size || [...expected].some(path => !paths.has(path))) {
      throw new Error('备份清单与数据库文件引用不一致')
    }
    if (manifest.files.some(file => expectedMediaTypes.get(file.path) !== file.mediaType)) {
      throw new Error('备份清单媒体类型与文件引用不一致')
    }
    return { manifest, fileCount: manifest.files.length, totalBytes }
  }

  /** @param backupDirectory 已存在备份目录。 @returns 原子切换结果与保留回退目录。 */
  async restore(backupDirectory: string): Promise<BackupRestoreResult> {
    const validation = await this.validate(backupDirectory)
    if (ApplicationInstanceLock.isActive(this.dataDirectory)) throw new Error('应用仍在运行，拒绝执行数据恢复')
    const parent = dirname(this.dataDirectory)
    const name = basename(this.dataDirectory)
    const staging = resolve(parent, `.${name}.restore-${randomUUID()}`)
    const rollback = resolve(parent, `${name}.rollback-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`)
    await mkdir(staging, { recursive: false })
    try {
      for (const file of validation.manifest.files) {
        const target = resolveControlled(staging, file.path)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(resolveControlled(absolute(backupDirectory), file.path), target)
      }
      for (const directory of ['sources', 'artifacts', 'exports', 'backups', 'logs']) {
        await mkdir(resolve(staging, directory), { recursive: true })
      }
      prepareRestoredDatabase(resolve(staging, DATABASE_NAME), validation.manifest.backupId)
      await rename(this.dataDirectory, rollback)
      try {
        await rename(staging, this.dataDirectory)
      }
      catch (error: unknown) {
        await rename(rollback, this.dataDirectory)
        throw error
      }
      return { backupId: validation.manifest.backupId, rollbackDirectory: rollback }
    }
    catch (error: unknown) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }
}

/**
 * 把在线副本切换为单主文件日志模式，防止验证产生未入清单的 WAL/SHM。
 * @param databasePath 新创建的 SQLite 备份副本。
 * @returns 日志模式切换和残留边车清理完成时结束。
 */
async function normalizeBackupDatabase(databasePath: string): Promise<void> {
  const database = new Database(databasePath, { fileMustExist: true })
  try {
    database.pragma('journal_mode = DELETE')
  }
  finally {
    database.close()
  }
  await rm(`${databasePath}-wal`, { force: true })
  await rm(`${databasePath}-shm`, { force: true })
}

/**
 * 递归列出备份目录的普通文件，并拒绝任何符号链接或特殊节点。
 * @param root 备份根绝对路径。
 * @param prefix 当前 POSIX 相对目录。
 * @returns 全部普通文件的 POSIX 相对路径。
 */
async function listBackupFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(prefix ? resolveBackupScanDirectory(root, prefix) : root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`备份拒绝符号链接：${path}`)
    if (entry.isDirectory()) {
      files.push(...await listBackupFiles(root, path))
    }
    else if (entry.isFile()) {
      files.push(path)
    }
    else {
      throw new Error(`备份拒绝特殊文件：${path}`)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

/**
 * 解析递归扫描使用的受控目录；目录不需要符合最终备份文件名规则。
 * @param root 备份根绝对路径。
 * @param relativeDirectory 非空的 POSIX 相对目录。
 * @returns 确认位于备份根内的目录绝对路径。
 */
function resolveBackupScanDirectory(root: string, relativeDirectory: string): string {
  const segments = relativeDirectory.split('/')
  if (relativeDirectory !== posix.normalize(relativeDirectory) || isAbsolute(relativeDirectory)
    || relativeDirectory.includes('\\') || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`备份目录路径无效：${relativeDirectory}`)
  }
  const target = resolve(root, relativeDirectory)
  if (!target.startsWith(`${root}${sep}`)) throw new Error('备份目录路径越过受控根目录')
  return target
}

/** @param databasePath SQLite 副本。 @param expectedMigrationCount 当前迁移数。 @returns 数据库引用文件和媒体类型。 */
function inspectDatabase(databasePath: string, expectedMigrationCount: number): Map<string, string> {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    if (String(firstValue(database.pragma('integrity_check'))) !== 'ok') throw new Error('备份 SQLite 完整性检查失败')
    if ((database.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error('备份 SQLite 外键检查失败')
    const migration = database.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as { count: number }
    if (migration.count !== expectedMigrationCount) throw new Error('备份 SQLite 迁移数量不兼容')
    const references = new Map<string, string>()
    const sourceRows = database.prepare(`
      SELECT original_file_path AS path FROM source_materials WHERE original_file_path IS NOT NULL
    `).all() as Array<{ path: string }>
    for (const row of sourceRows) references.set(row.path, row.path.endsWith('.md') ? 'text/markdown' : 'text/plain')
    const assetRows = database.prepare(`
      SELECT artifact_documents.run_id, image_assets.relative_path, image_assets.media_type
      FROM image_assets
      INNER JOIN block_attempts ON block_attempts.id = image_assets.attempt_id
      INNER JOIN artifact_blocks ON artifact_blocks.id = block_attempts.block_id
      INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
    `).all() as Array<{ run_id: string, relative_path: string, media_type: string }>
    for (const row of assetRows) references.set(`artifacts/${row.run_id}/${row.relative_path}`, row.media_type)
    for (const path of references.keys()) assertManifestPath(path)
    return new Map([...references.entries()].sort(([left], [right]) => left.localeCompare(right)))
  }
  finally {
    database.close()
  }
}

/** @param databasePath 待启用数据库。 @returns 重建 FTS、撤销会话并标记外部索引待重建。 */
function prepareRestoredDatabase(databasePath: string, backupId: string): void {
  const database = new Database(databasePath, { fileMustExist: true })
  try {
    database.pragma('journal_mode = DELETE')
    database.pragma('foreign_keys = ON')
    const timestamp = Date.now()
    database.transaction(() => {
      database.prepare(`INSERT INTO source_chunks_fts(source_chunks_fts) VALUES ('rebuild')`).run()
      database.prepare(`UPDATE administrators SET credential_version = credential_version + 1, updated_at = ?`).run(timestamp)
      database.prepare(`UPDATE context_sync_records SET status = 'pending', error = '数据恢复后需要全量重建 OpenViking 索引', updated_at = ?`).run(timestamp)
      insertAuditEvent(database, {
        actor: 'maintenance', action: 'data_restored', targetType: 'backup', targetId: backupId, timestamp,
      })
    })()
    if (String(firstValue(database.pragma('integrity_check'))) !== 'ok') throw new Error('恢复后 SQLite 完整性检查失败')
    if ((database.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error('恢复后 SQLite 外键检查失败')
  }
  finally {
    database.close()
  }
}

/** @param path 文件绝对路径。 @param relativePath 清单路径。 @param mediaType 媒体类型。 @returns 哈希描述。 */
async function describeFile(path: string, relativePath: string, mediaType: string): Promise<BackupManifestFile> {
  await assertRegularFile(path)
  const information = await stat(path)
  return { path: relativePath, mediaType, sizeBytes: information.size, sha256: await hashFile(path) }
}

/** @param path 文件绝对路径。 @returns 流式 SHA-256。 */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** @param path 文件绝对路径。 @returns 确认不是符号链接的普通文件。 */
async function assertRegularFile(path: string): Promise<void> {
  const information = await lstat(path)
  if (!information.isFile() || information.isSymbolicLink()) throw new Error(`备份拒绝非普通文件：${path}`)
}

/** @param value 清单 JSON。 @returns 通过基础结构校验的清单。 */
function parseManifest(value: string): BackupManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  }
  catch {
    throw new Error('备份清单不是有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('备份清单结构无效')
  const manifest = parsed as Partial<BackupManifest>
  if (manifest.version !== 1 || typeof manifest.backupId !== 'string' || !manifest.backupId
    || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))
    || !Number.isInteger(manifest.migrationCount) || !Array.isArray(manifest.files)) {
    throw new Error('备份清单字段无效')
  }
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || typeof file.mediaType !== 'string'
      || !Number.isInteger(file.sizeBytes) || file.sizeBytes < 0
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('备份清单文件项无效')
    }
  }
  return manifest as BackupManifest
}

/** @param path 清单相对路径。 @returns 路径合法时结束。 */
function assertManifestPath(path: string): void {
  if (path === DATABASE_NAME) return
  if (path !== posix.normalize(path) || isAbsolute(path) || path.includes('\\') || !FILE_PATH_PATTERN.test(path)) {
    throw new Error(`备份清单包含不受控路径：${path}`)
  }
}

/** @param root 受控根。 @param relativePath 受控相对路径。 @returns 根内绝对路径。 */
function resolveControlled(root: string, relativePath: string): string {
  assertManifestPath(relativePath)
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error('备份路径越过受控根目录')
  return target
}

/** @param value 相对或绝对路径。 @returns 基于进程目录的绝对路径。 */
function absolute(value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value)
}

/** @param migrationsDirectory Drizzle 迁移目录。 @returns 当前迁移数量。 */
function readMigrationCount(migrationsDirectory: string): number {
  const value = JSON.parse(requireText(resolve(migrationsDirectory, 'meta', '_journal.json'))) as { entries?: unknown[] }
  if (!Array.isArray(value.entries) || value.entries.length === 0) throw new Error('Drizzle 迁移日志无效')
  return value.entries.length
}

/** @param path 文本文件路径。 @returns UTF-8 正文。 */
function requireText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  }
  catch {
    throw new Error(`无法读取必要文件：${path}`)
  }
}

/** @param rows PRAGMA 结果。 @returns 第一行第一列。 */
function firstValue(rows: unknown): unknown {
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') return null
  return Object.values(rows[0] as Record<string, unknown>)[0]
}
