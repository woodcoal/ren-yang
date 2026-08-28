import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { ApplicationError } from '../../server/application/errors/ApplicationError'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import type { Clock } from '../../server/ports/Clock'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { PersonaSnapshot } from '../../shared/types/content'

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
  summary: '谨慎的档案管理员',
  identityFacts: '由用户原创设定。',
  interests: '历史与文献。',
  valuesAndMotivations: '重视证据。',
  expressionStyle: '简洁克制。',
  appearance: '',
  visualStyle: '',
  constraints: '资料不足时说明未知。',
}

/** 当前测试数据目录。 */
let temporaryDirectory: string
/** 当前测试数据库。 */
let database: SqliteDatabase
/** 当前测试应用服务。 */
let service: ContentApplicationService
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
  service = new ContentApplicationService({
    repository: new SqliteContentRepository(database.getClient()),
    identifiers,
    clock,
    sourceProcessor: new NodeSourceContentProcessor(identifiers),
    sourceFiles: new LocalSourceFileStorage(temporaryDirectory),
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
      WHERE name IN ('personas', 'persona_versions', 'worlds', 'world_versions',
        'source_materials', 'source_chunks', 'source_chunks_fts', 'source_chunks_fts_insert')
      ORDER BY name
    `).all()

    expect(objects).toEqual([
      { name: 'persona_versions', type: 'table' },
      { name: 'personas', type: 'table' },
      { name: 'source_chunks', type: 'table' },
      { name: 'source_chunks_fts', type: 'table' },
      { name: 'source_chunks_fts_insert', type: 'trigger' },
      { name: 'source_materials', type: 'table' },
      { name: 'world_versions', type: 'table' },
      { name: 'worlds', type: 'table' },
    ])
  })

  it('无资料创建原创人物，发布候选并通过指针回滚且不覆盖版本', async () => {
    const created = await service.createPersona({
      name: '林默',
      origin: 'original',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立原创人物',
    })
    const initialVersion = created.versions[0]!
    expect(created.persona).toMatchObject({ activeVersionId: null, sourceCount: 0, versionCount: 1 })

    clock.timestamp = 2_000
    await service.publishPersonaVersion(initialVersion.id)
    const candidate = await service.createPersonaVersion(created.persona.id, {
      baseVersionId: initialVersion.id,
      snapshot: { ...BASE_PERSONA_SNAPSHOT, expressionStyle: '冷静、简短，避免修辞。' },
      changeSummary: '收紧表达风格',
    })
    clock.timestamp = 3_000
    await service.publishPersonaVersion(candidate.id)

    const differences = await service.comparePersonaVersions(initialVersion.id, candidate.id)
    expect(differences).toEqual([{
      field: 'expressionStyle',
      label: '表达风格',
      before: '简洁克制。',
      after: '冷静、简短，避免修辞。',
    }])

    await service.rollbackPersona(created.persona.id, initialVersion.id)
    const afterRollback = await service.getPersona(created.persona.id)
    expect(afterRollback.persona.activeVersionId).toBe(initialVersion.id)
    expect(afterRollback.versions).toHaveLength(2)
    expect(afterRollback.versions.find(version => version.id === candidate.id)).toMatchObject({
      status: 'published',
      snapshot: { expressionStyle: '冷静、简短，避免修辞。' },
    })
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
      snapshot: { content: '所有城市位于浮岛，远行依赖风帆船。' },
      changeSummary: '建立世界设定',
    })
    await service.publishWorldVersion(world.versions[0]!.id)
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
})
