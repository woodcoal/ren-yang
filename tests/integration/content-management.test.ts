import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { SoulApplicationService } from '../../server/application/content/SoulApplicationService'
import { ApplicationError } from '../../server/application/errors/ApplicationError'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteAuditRepository } from '../../server/infrastructure/database/SqliteAuditRepository'
import { ConservativeTokenCounter } from '../../server/infrastructure/model/ConservativeTokenCounter'
import type { Clock } from '../../server/ports/Clock'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { PersonaSnapshot } from '../../shared/types/content'
import { listSourcesPageSchema } from '../../shared/schemas/content'

/** 为测试提供单调递增且符合 UUID 格式的标识。 */
class SequentialIdentifierGenerator implements IdentifierGenerator {
  /** 当前序号。 */
  private sequence = 0

  /**
   * 生成下一个稳定 UUID。
   * @returns 可预测但格式合法的 UUID。
   */
  create(): string {
    this.sequence += 1
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

/** 为测试提供可推进的固定时钟。 */
class MutableClock implements Clock {
  /** 当前 UTC Unix 毫秒。 */
  public timestamp = 1_000

  /**
   * 返回当前测试时间。
   * @returns UTC Unix 毫秒。
   */
  now(): number {
    return this.timestamp
  }
}

/** 基础人物档案。 */
const BASE_PERSONA_SNAPSHOT: PersonaSnapshot = {
  chapters: [
    { id: '00000000-0000-4000-8000-000000000101', title: '核心人设', content: '谨慎的档案管理员，重视证据。', order: 0, required: true },
    { id: '00000000-0000-4000-8000-000000000102', title: '表达与边界', content: '表达简洁克制；资料不足时说明未知。', order: 1, required: true },
  ],
  runtimeSummary: '谨慎的档案管理员，重视证据；表达简洁克制，资料不足时说明未知。',
}

/**
 * 创建单章节世界灵魂测试快照。
 * @param content 世界规则正文和运行摘要。
 * @returns 可直接提交的世界灵魂快照。
 */
function createWorldSnapshot(content: string) {
  return {
    chapters: [{ id: '00000000-0000-4000-8000-000000000201', title: '基本规则', content, order: 0, required: true }],
    runtimeSummary: content,
  }
}

/** 当前测试数据目录。 */
let temporaryDirectory: string
/** 当前测试数据库。 */
let database: SqliteDatabase
/** 当前测试应用服务。 */
let service: ContentApplicationService
/** 当前测试灵魂应用服务。 */
let soulService: SoulApplicationService
/** 当前测试时钟。 */
let clock: MutableClock

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-content-test-'))
  database = new SqliteDatabase({
    dataDirectory: temporaryDirectory,
    migrationsDirectory: resolve(process.cwd(), 'drizzle'),
  })
  const identifiers = new SequentialIdentifierGenerator()
  clock = new MutableClock()
  const repository = new SqliteContentRepository(database.getClient())
  service = new ContentApplicationService({
    repository,
    souls: repository,
    identifiers,
    clock,
    sourceProcessor: new NodeSourceContentProcessor(identifiers),
    sourceFiles: new LocalSourceFileStorage(temporaryDirectory),
  })
  soulService = new SoulApplicationService({
    content: repository,
    souls: repository,
    identifiers,
    clock,
    tokenCounter: new ConservativeTokenCounter(),
    tokenBudgets: { world: 2_500, persona: 3_500 },
  })
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('人物、世界与资料管理闭环', () => {
  it('从空库创建业务表、FTS5 虚表和同步触发器', () => {
    const objects = database.getClient().prepare(`
      SELECT name, type FROM sqlite_master
      WHERE name IN ('personas', 'soul_drafts', 'soul_versions', 'worlds',
        'source_materials', 'source_chunks', 'source_chunks_fts', 'source_chunks_fts_insert')
      ORDER BY name
    `).all()

    expect(objects).toEqual([
      { name: 'personas', type: 'table' },
      { name: 'soul_drafts', type: 'table' },
      { name: 'soul_versions', type: 'table' },
      { name: 'source_chunks', type: 'table' },
      { name: 'source_chunks_fts', type: 'table' },
      { name: 'source_chunks_fts_insert', type: 'trigger' },
      { name: 'source_materials', type: 'table' },
      { name: 'worlds', type: 'table' },
    ])
  })

  it('无资料创建原创人物，草稿发布后不可变且历史版本只能复制为新草稿', async () => {
    const created = await service.createPersona({
      name: '林默',
      origin: 'original',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立原创人物',
    })
    expect(created.persona).toMatchObject({ activeVersionId: null, sourceCount: 0, versionCount: 0 })
    expect(created.draft?.snapshot).toEqual(BASE_PERSONA_SNAPSHOT)

    clock.timestamp = 2_000
    const initialVersion = await soulService.publishDraft('persona', created.persona.id)
    await soulService.saveDraft('persona', created.persona.id, {
      baseVersionId: initialVersion.id,
      snapshot: { ...BASE_PERSONA_SNAPSHOT, runtimeSummary: '谨慎的档案管理员；表达冷静、简短，避免修辞。' },
      changeSummary: '收紧表达风格',
    })
    clock.timestamp = 3_000
    const changedVersion = await soulService.publishDraft('persona', created.persona.id)

    const differences = await service.comparePersonaVersions(initialVersion.id, changedVersion.id)
    expect(differences).toEqual([{
      field: 'runtimeSummary',
      label: '运行摘要',
      before: BASE_PERSONA_SNAPSHOT.runtimeSummary,
      after: '谨慎的档案管理员；表达冷静、简短，避免修辞。',
    }])

    await soulService.createDraftFromVersion('persona', created.persona.id, { versionId: initialVersion.id })
    const afterCopy = await soulService.getSoul('persona', created.persona.id)
    expect(afterCopy.activeVersion?.id).toBe(changedVersion.id)
    expect(afterCopy.draft).toMatchObject({ baseVersionId: initialVersion.id, snapshot: BASE_PERSONA_SNAPSHOT })
    expect(afterCopy.versions).toHaveLength(2)
  })

  it('资料型人物必须有关联资料，原创和混合型不强制资料', async () => {
    await expect(service.createPersona({
      name: '无依据人物',
      origin: 'source_based',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '错误创建',
    })).rejects.toMatchObject<ApplicationError>({ code: 'SOURCE_REQUIRED', statusCode: 422 })

    await expect(service.createPersona({
      name: '混合人物',
      origin: 'hybrid',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '用户设定优先',
    })).resolves.toMatchObject({ persona: { origin: 'hybrid' } })
  })

  it('保存可选世界版本，并在人设解除关联前阻止删除世界', async () => {
    const world = await service.createWorld({
      name: '浮岛纪元',
      summary: '以浮岛航行为核心的架空世界',
      snapshot: {
        chapters: [{ id: '00000000-0000-4000-8000-000000000201', title: '基本规则', content: '所有城市位于浮岛，远行依赖风帆船。', order: 0, required: true }],
        runtimeSummary: '所有城市位于浮岛，远行依赖风帆船。',
      },
      changeSummary: '建立世界设定',
    })
    await soulService.publishDraft('world', world.world.id)
    const persona = await service.createPersona({
      name: '船长',
      origin: 'original',
      worldId: world.world.id,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })

    await expect(service.getWorldDeletionImpact(world.world.id)).resolves.toMatchObject({
      canDelete: false,
      relatedPersonas: [{ id: persona.persona.id, name: '船长' }],
    })
    await expect(service.deleteWorld(world.world.id)).rejects.toMatchObject<ApplicationError>({
      code: 'RESOURCE_IN_USE',
      statusCode: 409,
    })

    await service.updatePersona(persona.persona.id, { name: '船长', worldId: null })
    await expect(service.deleteWorld(world.world.id)).resolves.toBeUndefined()
  })

  it('只允许删除非当前、无后续修改且未被历史任务使用的世界版本', async () => {
    const world = await service.createWorld({
      name: '浮岛纪元',
      summary: '世界版本删除约束测试',
      snapshot: createWorldSnapshot('初始规则。'),
      changeSummary: '初始版本',
    })
    const initialVersion = await soulService.publishDraft('world', world.world.id)
    await soulService.saveDraft('world', world.world.id, {
      baseVersionId: initialVersion.id,
      snapshot: createWorldSnapshot('曾被任务使用的规则。'),
      changeSummary: '历史任务使用版本',
    })
    const usedVersion = await soulService.publishDraft('world', world.world.id)
    await soulService.saveDraft('world', world.world.id, {
      baseVersionId: initialVersion.id,
      snapshot: createWorldSnapshot('当前规则。'),
      changeSummary: '当前版本',
    })
    const activeVersion = await soulService.publishDraft('world', world.world.id)

    const persona = await service.createPersona({
      name: '测试人物',
      origin: 'original',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })
    const personaVersion = await soulService.publishDraft('persona', persona.persona.id)
    const runId = '00000000-0000-4000-8000-000000000090'
    database.getClient().prepare(`
      INSERT INTO generation_runs (
        id, kind, persona_version_id, status, input_json, parameter_snapshot_json,
        model_snapshot_json, prompt_version, context_provider, created_at, updated_at, completed_at
      ) VALUES (?, 'interest_assessment', ?, 'succeeded', '{}', '{}', '{}', 'test-v1', 'sqlite_fts5', ?, ?, ?)
    `).run(runId, personaVersion.id, clock.timestamp, clock.timestamp, clock.timestamp)
    database.getClient().prepare(`
      INSERT INTO evidence_snapshots (
        id, run_id, role, content, content_hash, rank, metadata_json, created_at
      ) VALUES (?, ?, 'user_setting', ?, ?, 0, ?, ?)
    `).run(
      '00000000-0000-4000-8000-000000000091',
      runId,
      JSON.stringify(usedVersion.snapshot),
      'a'.repeat(64),
      JSON.stringify({ worldVersionId: usedVersion.id }),
      clock.timestamp,
    )

    await expect(service.deleteWorldVersion(activeVersion.id)).rejects.toMatchObject<ApplicationError>({
      code: 'RESOURCE_IN_USE',
      statusCode: 409,
    })
    await expect(service.deleteWorldVersion(initialVersion.id)).rejects.toMatchObject<ApplicationError>({
      code: 'RESOURCE_IN_USE',
      statusCode: 409,
    })
    await expect(service.deleteWorldVersion(usedVersion.id)).rejects.toMatchObject<ApplicationError>({
      code: 'RESOURCE_IN_USE',
      statusCode: 409,
    })

    await soulService.saveDraft('world', world.world.id, {
      baseVersionId: activeVersion.id,
      snapshot: createWorldSnapshot('明显错误的未使用规则。'),
      changeSummary: '错误版本',
    })
    const disposableVersion = await soulService.publishDraft('world', world.world.id)
    await soulService.saveDraft('world', world.world.id, {
      baseVersionId: activeVersion.id,
      snapshot: createWorldSnapshot('替代后的当前规则。'),
      changeSummary: '替代错误版本',
    })
    await soulService.publishDraft('world', world.world.id)
    await expect(service.deleteWorldVersion(disposableVersion.id)).resolves.toBeUndefined()
    await expect(service.getWorld(world.world.id)).resolves.not.toMatchObject({
      versions: expect.arrayContaining([expect.objectContaining({ id: disposableVersion.id })]),
    })
    expect(database.getClient().prepare(`
      SELECT action FROM audit_events WHERE target_id = ? ORDER BY created_at DESC
    `).all(disposableVersion.id)).toEqual(expect.arrayContaining([{ action: 'world_version_deleted' }]))
  })

  it('导入 UTF-8 Markdown、生成切片、执行中文 FTS5 检索并安全删除文件', async () => {
    const imported = await service.importSourceFile({
      name: '学院设定',
      role: 'canon_fact',
      fileName: 'canon.md',
      mediaType: 'text/markdown',
      bytes: new TextEncoder().encode('# 校规\n\n魔法学院禁止在夜间施法。\n\n# 地点\n\n图书馆位于北塔。'),
    })
    const originalPath = imported.source.originalFilePath!
    expect(imported.source).toMatchObject({ inputType: 'markdown', chunkCount: 2, linkCount: 0 })
    expect(existsSync(resolve(temporaryDirectory, originalPath))).toBe(true)

    await expect(service.searchSources('魔法学院', 10)).resolves.toEqual([
      expect.objectContaining({
        sourceId: imported.source.id,
        heading: '校规',
        content: '魔法学院禁止在夜间施法。',
      }),
    ])

    const updated = await service.updateSource(imported.source.id, {
      name: '学院设定修订',
      role: 'canon_fact',
      content: '# 新校规\n\n魔法学院允许在导师监督下夜间施法。',
    })
    expect(updated.source).toMatchObject({ inputType: 'paste', originalFilePath: null })
    expect(existsSync(resolve(temporaryDirectory, originalPath))).toBe(false)
    await expect(service.searchSources('禁止在夜间', 10)).resolves.toEqual([])

    await expect(service.searchSources('导师监督', 10)).resolves.toEqual([
      expect.objectContaining({ content: '魔法学院允许在导师监督下夜间施法。' }),
    ])
    await service.deleteSource(imported.source.id)
    await expect(service.searchSources('导师监督', 10)).resolves.toEqual([])
  })

  it('禁用资料后保留正文和关系但停止检索，重新启用后恢复', async () => {
    const source = await service.createPastedSource({
      name: '港口规则',
      role: 'canon_fact',
      content: '北港只允许登记过的风帆船靠岸。',
    })
    const world = await service.createWorld({
      name: '浮岛纪元', summary: '', snapshot: createWorldSnapshot('群岛依靠风帆船往来。'), changeSummary: '建立世界',
    })
    await service.linkSource(source.source.id, {
      targetType: 'world', targetId: world.world.id, priority: 10,
    })

    expect(source.source.isEnabled).toBe(true)
    await expect(service.searchSources('登记过的风帆船', 10)).resolves.toHaveLength(1)
    const disabled = await service.updateSourceStatus(source.source.id, { isEnabled: false })

    expect(disabled.source).toMatchObject({ isEnabled: false, contentText: '北港只允许登记过的风帆船靠岸。' })
    expect(disabled.links).toEqual([expect.objectContaining({ targetType: 'world', targetId: world.world.id })])
    expect(disabled.chunks).toHaveLength(1)
    await expect(service.searchSources('登记过的风帆船', 10)).resolves.toEqual([])

    const enabled = await service.updateSourceStatus(source.source.id, { isEnabled: true })
    expect(enabled.source.isEnabled).toBe(true)
    await expect(service.searchSources('登记过的风帆船', 10)).resolves.toHaveLength(1)
  })

  it('批量状态修改先验证全部资料，避免无效标识造成部分禁用', async () => {
    const first = await service.createPastedSource({ name: '第一份资料', role: 'reference', content: '第一份批量资料正文。' })
    const second = await service.createPastedSource({ name: '第二份资料', role: 'reference', content: '第二份批量资料正文。' })
    const invalidId = '00000000-0000-4000-8000-999999999999'

    await expect(service.updateSourcesStatus({
      sourceIds: [first.source.id, invalidId], isEnabled: false,
    })).rejects.toMatchObject<ApplicationError>({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(service.getSource(first.source.id)).resolves.toMatchObject({ source: { isEnabled: true } })

    await expect(service.updateSourcesStatus({
      sourceIds: [first.source.id, second.source.id, first.source.id], isEnabled: false,
    })).resolves.toEqual({ sourceIds: [first.source.id, second.source.id], isEnabled: false })
    await expect(service.getSource(first.source.id)).resolves.toMatchObject({ source: { isEnabled: false } })
    await expect(service.getSource(second.source.id)).resolves.toMatchObject({ source: { isEnabled: false } })
  })

  it('资料分页返回稳定页序、总数并修正超界页码', async () => {
    for (let index = 1; index <= 23; index += 1) {
      await service.createPastedSource({
        name: `分页资料 ${String(index).padStart(2, '0')}`,
        role: 'reference',
        content: `分页资料正文 ${index}。`,
      })
    }

    const first = await service.listSourcesPage({ page: 1, pageSize: 10 })
    const second = await service.listSourcesPage({ page: 2, pageSize: 10 })
    const third = await service.listSourcesPage({ page: 3, pageSize: 10 })
    const overflow = await service.listSourcesPage({ page: 999, pageSize: 10 })

    expect(listSourcesPageSchema.parse({})).toEqual({ page: 1, pageSize: 10 })
    expect(first).toMatchObject({ total: 23, page: 1, pageSize: 10, totalPages: 3 })
    expect(first.items).toHaveLength(10)
    expect(second).toMatchObject({ total: 23, page: 2, pageSize: 10, totalPages: 3 })
    expect(second.items).toHaveLength(10)
    expect(third).toMatchObject({ total: 23, page: 3, pageSize: 10, totalPages: 3 })
    expect(third.items).toHaveLength(3)
    expect(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size).toBe(23)
    expect(overflow).toEqual(third)
  })

  it('列出资料关联阻断项，解除关联后允许删除资料', async () => {
    const source = await service.createPastedSource({
      name: '表达样例',
      role: 'style_sample',
      content: '他说话一向简短，从不使用感叹号。',
    })
    const persona = await service.createPersona({
      name: '观察员',
      origin: 'original',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })
    const linked = await service.linkSource(source.source.id, {
      targetType: 'persona',
      targetId: persona.persona.id,
      priority: 10,
    })
    expect(linked.links).toEqual([
      expect.objectContaining({ targetType: 'persona', targetName: '观察员', priority: 10 }),
    ])
    await expect(service.getSourceDeletionImpact(source.source.id)).resolves.toMatchObject({
      canDelete: false,
      relatedPersonas: [{ id: persona.persona.id, name: '观察员' }],
    })

    await service.unlinkSource(source.source.id, linked.links[0]!.id)
    await expect(service.deleteSource(source.source.id)).resolves.toBeUndefined()
  })

  it('创建粘贴或文件资料时原子建立多个人物和世界关联', async () => {
    const world = await service.createWorld({
      name: '浮岛纪元', summary: '', snapshot: createWorldSnapshot('群岛依靠风帆船往来。'), changeSummary: '建立世界',
    })
    const persona = await service.createPersona({
      name: '档案员', origin: 'original', worldId: world.world.id, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    const targets = [
      { targetType: 'persona' as const, targetId: persona.persona.id },
      { targetType: 'world' as const, targetId: world.world.id },
    ]

    const pasted = await service.createPastedSource({
      name: '港口事实', role: 'canon_fact', content: '北港只允许风帆船靠岸。', targets,
    })
    expect(pasted.links).toEqual([
      expect.objectContaining({ targetType: 'persona', targetId: persona.persona.id, priority: 100 }),
      expect.objectContaining({ targetType: 'world', targetId: world.world.id, priority: 100 }),
    ])

    const imported = await service.importSourceFile({
      name: '表达样例', role: 'style_sample', fileName: 'style.txt', mediaType: 'text/plain',
      bytes: new TextEncoder().encode('表达简洁，避免感叹句。'), targets,
    })
    expect(imported.links).toEqual([
      expect.objectContaining({ targetType: 'persona', targetId: persona.persona.id, priority: 100 }),
      expect.objectContaining({ targetType: 'world', targetId: world.world.id, priority: 100 }),
    ])
  })

  it('无效初始关联不会留下资料、切片或原始文件', async () => {
    const invalidTargets = [{ targetType: 'world' as const, targetId: '00000000-0000-4000-8000-999999999999' }]
    await expect(service.createPastedSource({
      name: '无效文本', role: 'reference', content: '不应保存。', targets: invalidTargets,
    })).rejects.toMatchObject<ApplicationError>({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(service.importSourceFile({
      name: '无效文件', role: 'reference', fileName: 'invalid.txt', mediaType: 'text/plain',
      bytes: new TextEncoder().encode('不应保存。'), targets: invalidTargets,
    })).rejects.toMatchObject<ApplicationError>({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })

    await expect(service.listSources()).resolves.toEqual([])
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM source_chunks').get()).toEqual({ count: 0 })
  })

  it('仓储写入初始关系失败时回滚同事务中的资料和切片', async () => {
    const repository = new SqliteContentRepository(database.getClient())
    const sourceId = '00000000-0000-4000-8000-000000000300'
    await expect(repository.createSource({
      id: sourceId,
      name: '事务回滚资料',
      role: 'reference',
      inputType: 'paste',
      contentHash: 'a'.repeat(64),
      contentText: '关系写入失败时不应保留。',
      originalFilePath: null,
      chunks: [{
        id: '00000000-0000-4000-8000-000000000301', sourceId, ordinal: 0,
        heading: null, content: '关系写入失败时不应保留。', contentHash: 'b'.repeat(64),
      }],
      links: [{ targetType: 'world', targetId: '00000000-0000-4000-8000-999999999999', priority: 100 }],
      timestamp: 1_000,
    })).rejects.toThrow()

    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM source_materials').get()).toEqual({ count: 0 })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM source_chunks').get()).toEqual({ count: 0 })
  })

  it('拒绝二进制、非 UTF-8、错误扩展名和超限文件', async () => {
    const invalidFiles = [
      { fileName: 'payload.exe', bytes: new Uint8Array([65]) },
      { fileName: 'invalid.txt', bytes: new Uint8Array([0xff, 0xfe]) },
      { fileName: 'binary.md', bytes: new Uint8Array([65, 0, 66]) },
      { fileName: 'large.txt', bytes: new Uint8Array(2_000_001).fill(65) },
    ]

    for (const invalid of invalidFiles) {
      await expect(service.importSourceFile({
        name: '非法资料',
        role: 'reference',
        fileName: invalid.fileName,
        mediaType: 'application/octet-stream',
        bytes: invalid.bytes,
      })).rejects.toMatchObject<ApplicationError>({ code: 'VALIDATION_FAILED', statusCode: 400 })
    }
    await expect(service.listSources()).resolves.toEqual([])
  })

  it('灵魂发布和永久删除与对应审计记录在同一 SQLite 事务中完成', async () => {
    const source = await service.createPastedSource({ name: '临时资料', role: 'reference', content: '临时正文。' })
    const world = await service.createWorld({
      name: '临时世界', summary: '', snapshot: createWorldSnapshot('临时世界设定。'), changeSummary: '建立世界',
    })
    const persona = await service.createPersona({
      name: '临时人物', origin: 'original', worldId: null, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    await soulService.publishDraft('world', world.world.id)
    await soulService.publishDraft('persona', persona.persona.id)
    await service.deleteSource(source.source.id)
    await service.deleteWorld(world.world.id)
    await service.deletePersona(persona.persona.id)

    const audit = await new SqliteAuditRepository(database.getClient()).list(20)
    expect(audit.map(event => event.action)).toEqual(expect.arrayContaining([
      'soul_version_published',
      'source_deleted',
      'world_deleted',
      'persona_deleted',
    ]))
    expect(audit.every(event => !JSON.stringify(event.details).includes('临时正文'))).toBe(true)
  })
})
