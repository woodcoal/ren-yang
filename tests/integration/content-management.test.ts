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
import { AesGcmSecretCipher } from '../../server/infrastructure/security/AesGcmSecretCipher'
import type { Clock } from '../../server/ports/Clock'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../server/ports/TextModelPort'
import type { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { createTestAiPromptService } from '../support/createTestAiPromptService'
import type { PersonaSnapshot } from '../../shared/types/content'
import { listSourcesPageSchema, listSubjectsPageSchema } from '../../shared/schemas/content'

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

/** 返回固定结构结果并记录调用的灵魂整理测试模型。 */
class RecordingTextModel implements TextModelPort {
  /** 收到的全部模型请求，用于确认手动模式不会调用模型。 */
  public readonly requests: TextModelRequest[] = []

  /**
   * 创建固定结果模型。
   * @param structuredOutput 每次调用返回的结构化结果。
   * @param configured 是否声明模型已配置。
   */
  constructor(
    private readonly structuredOutput: unknown,
    private readonly configured = true,
  ) {}

  /**
   * 返回测试模型的非敏感配置快照。
   * @returns 已配置时返回固定快照，否则返回 null。
   */
  getConfiguredModel() {
    return this.configured
      ? { provider: 'openai_compatible' as const, model: 'soul-test-model', endpointOrigin: 'https://model.test' }
      : null
  }

  /**
   * 记录灵魂整理请求并返回预设结果。
   * @param request 应用服务构造的结构化模型请求。
   * @returns 固定结构化输出及零用量测试数据。
   */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    this.requests.push(request)
    return {
      structuredOutput: this.structuredOutput,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }
  }
}

/** 基础人物档案。 */
const BASE_PERSONA_SNAPSHOT: PersonaSnapshot = {
  promptText: '谨慎的档案管理员，重视证据；表达简洁克制，资料不足时说明未知。',
}

/**
 * 创建单文本世界灵魂测试快照。
 * @param content 世界规则提示词。
 * @returns 可直接提交的世界灵魂快照。
 */
function createWorldSnapshot(content: string) {
  return { promptText: content }
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
/** 使用真实迁移模板的测试提示词目录。 */
let aiPrompts: AiPromptApplicationService

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-content-test-'))
  database = new SqliteDatabase({
    dataDirectory: temporaryDirectory,
    migrationsDirectory: resolve(process.cwd(), 'drizzle'),
  })
  const identifiers = new SequentialIdentifierGenerator()
  clock = new MutableClock()
  const repository = new SqliteContentRepository(database.getClient())
  aiPrompts = createTestAiPromptService(database, identifiers, clock)
  service = new ContentApplicationService({
    repository,
    souls: repository,
    identifiers,
    clock,
    tokenCounter: new ConservativeTokenCounter(),
    tokenBudgets: { world: 2_500, persona: 3_500 },
    sourceProcessor: new NodeSourceContentProcessor(identifiers),
    sourceFiles: new LocalSourceFileStorage(temporaryDirectory),
    secretCipher: new AesGcmSecretCipher('content-test-secret-material-32-characters'),
    prompts: aiPrompts,
  })
  soulService = new SoulApplicationService({
    content: repository,
    souls: repository,
    identifiers,
    clock,
    tokenCounter: new ConservativeTokenCounter(),
    tokenBudgets: { world: 2_500, persona: 3_500 },
    prompts: aiPrompts,
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

  it('创建人物和世界时初始灵魂立即成为当前版本且对象默认启用', async () => {
    const created = await service.createPersona({
      name: '林默',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立原创人物',
    })
    expect(created.persona).toMatchObject({
      activeVersionId: expect.any(String), isEnabled: true, automaticLearningEnabled: false, sourceCount: 0, versionCount: 1,
    })
    expect(created.versions).toHaveLength(1)
    expect(created.versions[0]?.snapshot).toEqual(BASE_PERSONA_SNAPSHOT)
    expect(created.draft).toBeNull()

    const world = await service.createWorld({
      name: '浮岛纪元', summary: '', snapshot: createWorldSnapshot('浮岛依靠浮石保持稳定。'), changeSummary: '建立世界',
    })
    expect(world.world).toMatchObject({
      activeVersionId: expect.any(String), isEnabled: true, automaticLearningEnabled: false, versionCount: 1,
    })
    expect(world.versions[0]?.snapshot).toEqual({ promptText: '浮岛依靠浮石保持稳定。' })
    expect(world.draft).toBeNull()
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM soul_drafts').get()).toEqual({ count: 0 })
  })

  it('人物与世界自动提炼开关独立保存且默认关闭', async () => {
    const persona = await service.createPersona({
      name: '自动学习人物', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    const world = await service.createWorld({
      name: '自动学习世界', summary: '', snapshot: createWorldSnapshot('测试世界。'), changeSummary: '建立世界',
    })

    await expect(service.updatePersonaLearningAutomation(persona.persona.id, { enabled: true }))
      .resolves.toMatchObject({ persona: { automaticLearningEnabled: true } })
    await expect(service.updateWorldLearningAutomation(world.world.id, { enabled: true }))
      .resolves.toMatchObject({ world: { automaticLearningEnabled: true } })
  })

  it('人物账号信息加密保存、主动取回，并按小写全局约束账号和邮箱唯一', async () => {
    const first = await service.createPersona({
      name: '账号人物一', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物', username: 'LinMo', email: 'LinMo@Example.COM', password: '原始密码-123',
    })
    expect(first.credentials).toEqual({ username: 'linmo', email: 'linmo@example.com', passwordConfigured: true })
    const row = database.getClient().prepare(`
      SELECT username, email, password_ciphertext FROM personas WHERE id = ?
    `).get(first.persona.id) as { username: string, email: string, password_ciphertext: string }
    expect(row).toMatchObject({ username: 'linmo', email: 'linmo@example.com' })
    expect(row.password_ciphertext).not.toContain('原始密码-123')
    expect(await service.revealPersonaCredential(first.persona.id)).toEqual({
      username: 'linmo', email: 'linmo@example.com', password: '原始密码-123',
    })

    const second = await service.createPersona({
      name: '账号人物二', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    await expect(service.savePersonaCredential(second.persona.id, {
      username: 'LINMO', email: 'second@example.com', password: '第二个密码',
    })).rejects.toMatchObject<ApplicationError>({ code: 'USERNAME_CONFLICT', statusCode: 409 })
    await expect(service.savePersonaCredential(second.persona.id, {
      username: 'second', email: 'LINMO@EXAMPLE.COM', password: '第二个密码',
    })).rejects.toMatchObject<ApplicationError>({ code: 'EMAIL_CONFLICT', statusCode: 409 })
    await expect(service.savePersonaCredential(second.persona.id, {
      username: 'linmo@example.com', email: 'second@example.com', password: '第二个密码',
    })).rejects.toMatchObject<ApplicationError>({ code: 'USERNAME_CONFLICT', statusCode: 409 })
    await expect(service.savePersonaCredential(second.persona.id, {
      username: 'second', email: 'linmo', password: '第二个密码',
    })).rejects.toMatchObject<ApplicationError>({ code: 'EMAIL_CONFLICT', statusCode: 409 })
  })

  it('公共人物标识按 UUID、用户名或邮箱解析，并拒绝不存在或跨字段歧义的别名', async () => {
    const first = await service.createPersona({
      name: '别名人物一', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物', username: 'PersonaAlias', email: 'Persona@One.Example',
    })

    await expect(service.resolvePersonaIdentifier(first.persona.id)).resolves.toBe(first.persona.id)
    await expect(service.resolvePersonaIdentifier('  PERSONAALIAS  ')).resolves.toBe(first.persona.id)
    await expect(service.resolvePersonaIdentifier(' PERSONA@ONE.EXAMPLE ')).resolves.toBe(first.persona.id)
    await expect(service.resolvePersonaIdentifier('missing-persona')).rejects.toMatchObject<ApplicationError>({
      code: 'RESOURCE_NOT_FOUND', statusCode: 404,
    })

    const second = await service.createPersona({
      name: '别名人物二', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物', username: 'second-alias',
    })
    database.getClient().prepare('UPDATE personas SET email = ? WHERE id = ?').run('personaalias', second.persona.id)
    await expect(service.resolvePersonaIdentifier('personaalias')).rejects.toMatchObject<ApplicationError>({
      code: 'PERSONA_IDENTIFIER_AMBIGUOUS', statusCode: 409,
    })
  })

  it('账号、邮箱和密码可分别配置，修改账号时保留原密码', async () => {
    const accountOnly = await service.createPersona({
      name: '仅账号人物', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物', username: 'OnlyAccount',
    })
    expect(accountOnly.credentials).toEqual({ username: 'onlyaccount', email: null, passwordConfigured: false })

    const emailOnly = await service.createPersona({
      name: '仅邮箱人物', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物', email: 'OnlyEmail@Example.COM',
    })
    expect(emailOnly.credentials).toEqual({ username: null, email: 'onlyemail@example.com', passwordConfigured: false })

    const passwordOnly = await service.createPersona({
      name: '仅密码人物', worldId: null, sourceIds: [], snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物', password: '单独保存的密码',
    })
    expect(passwordOnly.credentials).toEqual({ username: null, email: null, passwordConfigured: true })
    expect(await service.revealPersonaCredential(passwordOnly.persona.id)).toEqual({
      username: null, email: null, password: '单独保存的密码',
    })

    await service.savePersonaCredential(passwordOnly.persona.id, {
      username: 'LaterAccount', email: '', password: '',
    })
    expect(await service.revealPersonaCredential(passwordOnly.persona.id)).toEqual({
      username: 'lateraccount', email: null, password: '单独保存的密码',
    })
  })

  it('保存灵魂立即生成不可变历史并切换当前版本', async () => {
    const created = await service.createPersona({
      name: '历史测试人物', worldId: null, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    const initialVersionId = created.persona.activeVersionId!

    clock.timestamp = 2_000
    const changedVersion = await soulService.saveVersion('persona', created.persona.id, {
      baseVersionId: initialVersionId,
      snapshot: { promptText: '谨慎的档案管理员；表达冷静、简短，避免修辞。' },
    })
    const changedWorkspace = await soulService.getSoul('persona', created.persona.id)
    expect(changedWorkspace.activeVersion?.id).toBe(changedVersion.id)
    expect(changedWorkspace.versions).toHaveLength(2)
    expect(changedWorkspace.versions.find(version => version.id === initialVersionId)?.snapshot).toEqual(BASE_PERSONA_SNAPSHOT)

    clock.timestamp = 3_000
    const restoredVersion = await soulService.saveVersion('persona', created.persona.id, {
      baseVersionId: initialVersionId,
      snapshot: BASE_PERSONA_SNAPSHOT,
    })
    const restoredWorkspace = await soulService.getSoul('persona', created.persona.id)
    expect(restoredWorkspace.activeVersion?.id).toBe(restoredVersion.id)
    expect(restoredWorkspace.activeVersion?.parentVersionId).toBe(initialVersionId)
    expect(restoredWorkspace.activeVersion?.changeSummary).toBe('回溯历史提示词并保存')
    expect(restoredWorkspace.versions).toHaveLength(3)
    expect(restoredWorkspace.draft).toBeNull()
  })

  it('创建和保存灵魂在 Token 上限内成功且超限时不产生版本', async () => {
    const created = await service.createPersona({
      name: '预算边界人物', worldId: null, sourceIds: [],
      snapshot: { promptText: '界'.repeat(3_500) }, changeSummary: '建立预算边界人物',
    })
    const initialVersionId = created.persona.activeVersionId!

    const boundaryVersion = await soulService.saveVersion('persona', created.persona.id, {
      baseVersionId: initialVersionId,
      snapshot: { promptText: '人'.repeat(3_500) },
    })
    await expect(soulService.saveVersion('persona', created.persona.id, {
      baseVersionId: boundaryVersion.id,
      snapshot: { promptText: '人'.repeat(3_501) },
    })).rejects.toMatchObject<ApplicationError>({ code: 'SOUL_TOKEN_BUDGET_EXCEEDED', statusCode: 422 })

    const workspace = await soulService.getSoul('persona', created.persona.id)
    expect(workspace.activeVersion?.id).toBe(boundaryVersion.id)
    expect(workspace.versions).toHaveLength(2)
  })

  it('保存灵魂拒绝使用其他对象的历史版本且不改变当前版本', async () => {
    const first = await service.createPersona({
      name: '第一位归属测试人物', worldId: null, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立第一位人物',
    })
    const second = await service.createPersona({
      name: '第二位归属测试人物', worldId: null, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立第二位人物',
    })

    await expect(soulService.saveVersion('persona', first.persona.id, {
      baseVersionId: second.persona.activeVersionId,
      snapshot: { promptText: '不应保存到第一位人物。' },
    })).rejects.toMatchObject<ApplicationError>({ code: 'VERSION_CONFLICT', statusCode: 409 })

    const workspace = await soulService.getSoul('persona', first.persona.id)
    expect(workspace.activeVersion?.id).toBe(first.persona.activeVersionId)
    expect(workspace.versions).toHaveLength(1)
  })

  it('手动保存灵魂只移除首尾空白且不调用模型', async () => {
    const created = await service.createPersona({
      name: '手动整理测试人物',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })
    const model = new RecordingTextModel({ promptText: '模型不应被调用。' })
    const manualSoulService = new SoulApplicationService({
      content: new SqliteContentRepository(database.getClient()),
      souls: new SqliteContentRepository(database.getClient()),
      identifiers: new SequentialIdentifierGenerator(),
      clock,
      tokenCounter: new ConservativeTokenCounter(),
      model,
      prompts: aiPrompts,
      tokenBudgets: { world: 2_500, persona: 3_500 },
    })

    const version = await manualSoulService.saveVersion('persona', created.persona.id, {
      baseVersionId: created.persona.activeVersionId,
      snapshot: { promptText: '  第一段。\n\n  第二段。  ' },
    })

    expect(version.snapshot.promptText).toBe('第一段。\n\n  第二段。')
    expect(version.changeSummary).toBe('修改灵魂提示词')
    expect((await manualSoulService.getSoul('persona', created.persona.id)).activeVersion?.id).toBe(version.id)
    expect(model.requests).toEqual([])
  })

  it('创建前独立整理灵魂不写入人物、世界或草稿', async () => {
    const model = new RecordingTextModel({ promptText: '谨慎的档案管理员；资料不足时明确说明未知。' })
    const repository = new SqliteContentRepository(database.getClient())
    const analyzedSoulService = new SoulApplicationService({
      content: repository,
      souls: repository,
      identifiers: new SequentialIdentifierGenerator(),
      clock,
      tokenCounter: new ConservativeTokenCounter(),
      model,
      prompts: aiPrompts,
      tokenBudgets: { world: 2_500, persona: 3_500 },
    })

    await expect(analyzedSoulService.analyzePrompt('persona', '谨慎的档案管理员。')).resolves.toEqual({
      promptText: '谨慎的档案管理员；资料不足时明确说明未知。',
    })
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.parameters.temperature).toBe(0.2)
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM personas').get()).toEqual({ count: 0 })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM worlds').get()).toEqual({ count: 0 })
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM soul_drafts').get()).toEqual({ count: 0 })
  })

  it('自动分析不可用或输出无效时不改变当前灵魂版本', async () => {
    const created = await service.createPersona({
      name: '失败保护测试人物',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })
    const originalWorkspace = await soulService.getSoul('persona', created.persona.id)
    const repository = new SqliteContentRepository(database.getClient())
    /**
     * 创建使用指定测试模型的灵魂应用服务。
     * @param model 待验证的固定模型端口。
     * @returns 共享当前测试数据库的灵魂应用服务。
     */
    const createAnalyzedSoulService = (model: TextModelPort) => new SoulApplicationService({
      content: repository,
      souls: repository,
      identifiers: new SequentialIdentifierGenerator(),
      clock,
      tokenCounter: new ConservativeTokenCounter(),
      model,
      prompts: aiPrompts,
      tokenBudgets: { world: 2_500, persona: 3_500 },
    })

    await expect(createAnalyzedSoulService(new RecordingTextModel({}, false)).analyzePrompt(
      'persona',
      '不应保存的输入一。',
    )).rejects.toMatchObject<ApplicationError>({ code: 'CAPABILITY_DISABLED', statusCode: 422 })
    await expect(createAnalyzedSoulService(new RecordingTextModel({ promptText: '   ' })).analyzePrompt(
      'persona',
      '不应保存的输入二。',
    )).rejects.toMatchObject<ApplicationError>({ code: 'MODEL_OUTPUT_INVALID', statusCode: 502 })
    await expect(soulService.getSoul('persona', created.persona.id)).resolves.toMatchObject({
      draft: null,
      activeVersion: { id: originalWorkspace.activeVersion?.id, snapshot: BASE_PERSONA_SNAPSHOT },
      versions: [{ id: originalWorkspace.activeVersion?.id }],
    })
  })

  it('创建人物不再区分来源模式且参考资料可为空', async () => {
    await expect(service.createPersona({
      name: '独立人物',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })).resolves.toMatchObject({ persona: { origin: 'original', sourceCount: 0 } })
  })

  it('保存可选世界版本，并在人设解除关联前阻止删除世界', async () => {
    const world = await service.createWorld({
      name: '浮岛纪元',
      summary: '以浮岛航行为核心的架空世界',
      snapshot: {
        promptText: '所有城市位于浮岛，远行依赖风帆船。',
      },
      changeSummary: '建立世界',
    })
    await soulService.publishDraft('world', world.world.id)
    const persona = await service.createPersona({
      name: '船长',
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

  it('永久删除已有成长分析历史的世界', async () => {
    const world = await service.createWorld({
      name: '分析历史世界',
      summary: '验证已有成长分析历史时仍可删除',
      snapshot: createWorldSnapshot('世界规则。'),
      changeSummary: '建立世界',
    })
    database.getClient().prepare(`
      INSERT INTO analysis_batches (
        id, analysis_type, world_id, mode, baseline_soul_version_id,
        baseline_json, model_snapshot_json, parameter_snapshot_json,
        prompt_version, status, created_at, updated_at
      ) VALUES (?, 'world_growth', ?, 'incremental', ?, '{}', '{}', '{}', 'test', 'completed', ?, ?)
    `).run(
      '00000000-0000-4000-8000-999999999999',
      world.world.id,
      world.world.activeVersionId,
      clock.now(),
      clock.now(),
    )

    await expect(service.deleteWorld(world.world.id)).resolves.toBeUndefined()
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM analysis_batches WHERE world_id = ?').get(world.world.id))
      .toEqual({ count: 0 })
  })

  it('永久删除已有成长分析历史的人物', async () => {
    const persona = await service.createPersona({
      name: '分析历史人物',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })
    database.getClient().prepare(`
      INSERT INTO analysis_batches (
        id, analysis_type, persona_id, mode, baseline_soul_version_id,
        baseline_json, model_snapshot_json, parameter_snapshot_json,
        prompt_version, status, created_at, updated_at
      ) VALUES (?, 'persona_growth', ?, 'incremental', ?, '{}', '{}', '{}', 'test', 'completed', ?, ?)
    `).run(
      '00000000-0000-4000-8000-999999999998',
      persona.persona.id,
      persona.persona.activeVersionId,
      clock.now(),
      clock.now(),
    )

    await expect(service.deletePersona(persona.persona.id)).resolves.toBeUndefined()
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM analysis_batches WHERE persona_id = ?').get(persona.persona.id))
      .toEqual({ count: 0 })
  })

  it('永久删除已有记忆证据的人物', async () => {
    const persona = await service.createPersona({
      name: '记忆证据人物',
      worldId: null,
      sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT,
      changeSummary: '建立人物',
    })
    const client = database.getClient()
    client.prepare(`
      INSERT INTO generation_runs (
        id, kind, persona_version_id, status, input_json, parameter_snapshot_json,
        model_snapshot_json, prompt_version, context_provider, created_at, updated_at
      ) VALUES (?, 'interest_assessment', ?, 'succeeded', '{}', '{}', '{}', 'test', 'sqlite_fts5', ?, ?)
    `).run('00000000-0000-4000-8000-999999999997', persona.persona.activeVersionId, clock.now(), clock.now())
    client.prepare(`
      INSERT INTO persona_operation_records (
        id, persona_id, run_id, operation_type, result_summary,
        context_snapshot_json, importance, created_at, updated_at
      ) VALUES (?, ?, ?, 'interest_assessment', '测试结论', '{}', 3, ?, ?)
    `).run(
      '00000000-0000-4000-8000-999999999996',
      persona.persona.id,
      '00000000-0000-4000-8000-999999999997',
      clock.now(),
      clock.now(),
    )
    client.prepare(`
      INSERT INTO memory_records (
        id, persona_id, current_revision_id, memory_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'interest', 'active', ?, ?)
    `).run(
      '00000000-0000-4000-8000-999999999995',
      persona.persona.id,
      '00000000-0000-4000-8000-999999999994',
      clock.now(),
      clock.now(),
    )
    client.prepare(`
      INSERT INTO memory_revisions (
        id, memory_id, revision_no, content, content_hash, scope,
        importance, independent_evidence_count, created_by, created_at
      ) VALUES (?, ?, 1, '测试记忆', ?, '人物', 3, 1, 'analysis', ?)
    `).run(
      '00000000-0000-4000-8000-999999999994',
      '00000000-0000-4000-8000-999999999995',
      'a'.repeat(64),
      clock.now(),
    )
    client.prepare(`
      INSERT INTO memory_revision_evidence (
        id, memory_revision_id, operation_record_id, run_id, relationship
      ) VALUES (?, ?, ?, ?, 'supporting')
    `).run(
      '00000000-0000-4000-8000-999999999993',
      '00000000-0000-4000-8000-999999999994',
      '00000000-0000-4000-8000-999999999996',
      '00000000-0000-4000-8000-999999999997',
    )

    await expect(service.deletePersona(persona.persona.id)).resolves.toBeUndefined()
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
      autoAnalyze: false,
    })
    const usedVersion = await soulService.publishDraft('world', world.world.id)
    await soulService.saveDraft('world', world.world.id, {
      baseVersionId: initialVersion.id,
      snapshot: createWorldSnapshot('当前规则。'),
      autoAnalyze: false,
    })
    const activeVersion = await soulService.publishDraft('world', world.world.id)

    const persona = await service.createPersona({
      name: '测试人物',
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
      autoAnalyze: false,
    })
    const disposableVersion = await soulService.publishDraft('world', world.world.id)
    await soulService.saveDraft('world', world.world.id, {
      baseVersionId: activeVersion.id,
      snapshot: createWorldSnapshot('替代后的当前规则。'),
      autoAnalyze: false,
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
      originUrl: 'https://example.com/canon',
      authorName: '学院档案室',
      publishedAt: 1_700_000_000_000,
      originalSourceKey: 'academy:canon:v1',
    })
    const originalPath = imported.source.originalFilePath!
    expect(imported.source).toMatchObject({
      inputType: 'markdown',
      chunkCount: 2,
      linkCount: 0,
      originUrl: 'https://example.com/canon',
      authorName: '学院档案室',
      publishedAt: 1_700_000_000_000,
      originalSourceKey: 'academy:canon:v1',
    })
    expect(existsSync(resolve(temporaryDirectory, originalPath))).toBe(true)

    await expect(service.searchSources('魔法学院', 10)).resolves.toEqual([
      expect.objectContaining({
        sourceId: imported.source.id,
        sourceName: '学院设定',
        heading: '校规',
        content: '魔法学院禁止在夜间施法。',
      }),
    ])

    const updated = await service.updateSource(imported.source.id, {
      name: '学院设定修订',
      role: 'canon_fact',
      content: '# 新校规\n\n魔法学院允许在导师监督下夜间施法。',
    })
    expect(updated.source).toMatchObject({
      inputType: 'paste',
      originalFilePath: null,
      originUrl: 'https://example.com/canon',
      authorName: '学院档案室',
      publishedAt: 1_700_000_000_000,
      originalSourceKey: 'academy:canon:v1',
    })
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

    await expect(service.updateSourcesStatus({
      sourceIds: [first.source.id, second.source.id], isEnabled: true,
    })).resolves.toEqual({ sourceIds: [first.source.id, second.source.id], isEnabled: true })
    await expect(service.getSource(first.source.id)).resolves.toMatchObject({ source: { isEnabled: true } })
    await expect(service.getSource(second.source.id)).resolves.toMatchObject({ source: { isEnabled: true } })
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

    expect(listSourcesPageSchema.parse({})).toEqual({
      page: 1, pageSize: 10, status: 'all', sort: 'updatedAt', order: 'desc',
    })
    expect(first).toMatchObject({ total: 23, page: 1, pageSize: 10, totalPages: 3 })
    expect(first.items).toHaveLength(10)
    expect(second).toMatchObject({ total: 23, page: 2, pageSize: 10, totalPages: 3 })
    expect(second.items).toHaveLength(10)
    expect(third).toMatchObject({ total: 23, page: 3, pageSize: 10, totalPages: 3 })
    expect(third.items).toHaveLength(3)
    expect(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size).toBe(23)
    expect(overflow).toEqual(third)

    const filtered = await service.listSourcesPage({ page: 1, pageSize: 10, query: '分页资料 02' })
    expect(filtered).toMatchObject({ total: 1, page: 1, pageSize: 10, totalPages: 1 })
    expect(filtered.items.map(item => item.name)).toEqual(['分页资料 02'])
  })

  it('人物与世界分页使用默认每页十项并修正越界页码', async () => {
    for (let index = 1; index <= 13; index += 1) {
      await service.createWorld({
        name: `分页世界 ${String(index).padStart(2, '0')}`, summary: '',
        snapshot: createWorldSnapshot(`分页世界规则 ${index}。`), changeSummary: '建立分页世界',
      })
      await service.createPersona({
        name: `分页人物 ${String(index).padStart(2, '0')}`, worldId: null, sourceIds: [],
        snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立分页人物',
      })
    }

    const personaFirst = await service.listPersonasPage({ page: 1, pageSize: 10 })
    const personaLast = await service.listPersonasPage({ page: 999, pageSize: 10 })
    const worldFirst = await service.listWorldsPage({ page: 1, pageSize: 10 })
    const worldLast = await service.listWorldsPage({ page: 999, pageSize: 10 })

    expect(listSubjectsPageSchema.parse({})).toEqual({
      page: 1, pageSize: 10, status: 'all', sort: 'updatedAt', order: 'desc',
    })
    expect(personaFirst).toMatchObject({ total: 13, page: 1, pageSize: 10, totalPages: 2 })
    expect(personaFirst.items).toHaveLength(10)
    expect(personaLast).toMatchObject({ total: 13, page: 2, pageSize: 10, totalPages: 2 })
    expect(personaLast.items).toHaveLength(3)
    expect(worldFirst).toMatchObject({ total: 13, page: 1, pageSize: 10, totalPages: 2 })
    expect(worldFirst.items).toHaveLength(10)
    expect(worldLast).toMatchObject({ total: 13, page: 2, pageSize: 10, totalPages: 2 })
    expect(worldLast.items).toHaveLength(3)

    const personaFiltered = await service.listPersonasPage({ page: 1, pageSize: 10, query: '分页人物 02' })
    expect(personaFiltered).toMatchObject({ total: 1, page: 1, pageSize: 10, totalPages: 1 })
    expect(personaFiltered.items.map(item => item.name)).toEqual(['分页人物 02'])
    const worldFiltered = await service.listWorldsPage({ page: 1, pageSize: 10, query: '分页世界 02' })
    expect(worldFiltered).toMatchObject({ total: 1, page: 1, pageSize: 10, totalPages: 1 })
    expect(worldFiltered.items.map(item => item.name)).toEqual(['分页世界 02'])
  })

  it('人物与世界批量状态修改先验证全部对象并保留原有关联', async () => {
    const firstWorld = await service.createWorld({
      name: '第一世界', summary: '', snapshot: createWorldSnapshot('第一世界规则。'), changeSummary: '建立世界',
    })
    const secondWorld = await service.createWorld({
      name: '第二世界', summary: '', snapshot: createWorldSnapshot('第二世界规则。'), changeSummary: '建立世界',
    })
    const firstPersona = await service.createPersona({
      name: '第一人物', worldId: firstWorld.world.id, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    const secondPersona = await service.createPersona({
      name: '第二人物', worldId: null, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    const invalidId = '00000000-0000-4000-8000-999999999999'

    await expect(service.updatePersonasStatus({
      personaIds: [firstPersona.persona.id, invalidId], isEnabled: false,
    })).rejects.toMatchObject<ApplicationError>({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(service.getPersona(firstPersona.persona.id)).resolves.toMatchObject({ persona: { isEnabled: true } })
    await expect(service.updateWorldsStatus({
      worldIds: [firstWorld.world.id, invalidId], isEnabled: false,
    })).rejects.toMatchObject<ApplicationError>({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(service.getWorld(firstWorld.world.id)).resolves.toMatchObject({ world: { isEnabled: true } })

    await expect(service.updatePersonasStatus({
      personaIds: [firstPersona.persona.id, secondPersona.persona.id, firstPersona.persona.id], isEnabled: false,
    })).resolves.toEqual({ personaIds: [firstPersona.persona.id, secondPersona.persona.id], isEnabled: false })
    await expect(service.updateWorldsStatus({
      worldIds: [firstWorld.world.id, secondWorld.world.id, firstWorld.world.id], isEnabled: false,
    })).resolves.toEqual({ worldIds: [firstWorld.world.id, secondWorld.world.id], isEnabled: false })
    await expect(service.getPersona(firstPersona.persona.id)).resolves.toMatchObject({
      persona: { isEnabled: false, worldId: firstWorld.world.id },
    })
    await expect(service.getWorld(firstWorld.world.id)).resolves.toMatchObject({
      world: { isEnabled: false }, personas: [expect.objectContaining({ id: firstPersona.persona.id })],
    })
    await expect(service.updatePersona(firstPersona.persona.id, {
      name: '第一人物改名', worldId: firstWorld.world.id,
    })).resolves.toMatchObject({ persona: { name: '第一人物改名', worldId: firstWorld.world.id } })

    await expect(service.updatePersonaStatus(firstPersona.persona.id, { isEnabled: true })).resolves.toMatchObject({
      persona: { isEnabled: true },
    })
    await expect(service.updateWorldStatus(firstWorld.world.id, { isEnabled: true })).resolves.toMatchObject({
      world: { isEnabled: true },
    })
  })

  it('列出资料关联阻断项，解除关联后允许删除资料', async () => {
    const source = await service.createPastedSource({
      name: '表达样例',
      role: 'style_sample',
      content: '他说话一向简短，从不使用感叹号。',
    })
    const persona = await service.createPersona({
      name: '观察员',
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

  it('批量替换全局资料集合并阻止直接删除仍在使用的全局资料', async () => {
    const first = await service.createPastedSource({ name: '全局规则', role: 'canon_fact', content: '所有人物必须标注未知信息。' })
    const second = await service.createPastedSource({ name: '共享风格', role: 'style_sample', content: '回答保持简洁。' })

    await expect(service.replaceGlobalSources({ sourceIds: [first.source.id, second.source.id, first.source.id] }))
      .resolves.toMatchObject({
        sourceIds: [first.source.id, second.source.id],
        addedSourceIds: [first.source.id, second.source.id],
        removedSourceIds: [],
      })
    await expect(service.getSource(first.source.id)).resolves.toMatchObject({ source: { isGlobal: true } })
    await expect(service.getSourceDeletionImpact(first.source.id)).resolves.toMatchObject({
      canDelete: false,
      blockers: ['资料当前是全局资料，必须先从全局资源中移除'],
    })

    await expect(service.replaceGlobalSources({ sourceIds: [second.source.id] })).resolves.toMatchObject({
      sourceIds: [second.source.id], addedSourceIds: [], removedSourceIds: [first.source.id],
    })
    await expect(service.deleteSource(first.source.id)).resolves.toBeUndefined()
  })

  it('创建粘贴或文件资料时原子建立多个人物和世界关联', async () => {
    const world = await service.createWorld({
      name: '浮岛纪元', summary: '', snapshot: createWorldSnapshot('群岛依靠风帆船往来。'), changeSummary: '建立世界',
    })
    const persona = await service.createPersona({
      name: '档案员', worldId: world.world.id, sourceIds: [],
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

  it('灵魂保存和永久删除与对应审计记录在同一 SQLite 事务中完成', async () => {
    const source = await service.createPastedSource({ name: '临时资料', role: 'reference', content: '临时正文。' })
    const world = await service.createWorld({
      name: '临时世界', summary: '', snapshot: createWorldSnapshot('临时世界。'), changeSummary: '建立世界',
    })
    const persona = await service.createPersona({
      name: '临时人物', worldId: null, sourceIds: [],
      snapshot: BASE_PERSONA_SNAPSHOT, changeSummary: '建立人物',
    })
    await soulService.saveVersion('world', world.world.id, {
      baseVersionId: world.world.activeVersionId,
      snapshot: createWorldSnapshot('修改后的临时世界。'),
    })
    await soulService.saveVersion('persona', persona.persona.id, {
      baseVersionId: persona.persona.activeVersionId,
      snapshot: { promptText: '修改后的临时人物。' },
    })
    await service.deleteSource(source.source.id)
    await service.deleteWorld(world.world.id)
    await service.deletePersona(persona.persona.id)

    const audit = await new SqliteAuditRepository(database.getClient()).list(20)
    expect(audit.map(event => event.action)).toEqual(expect.arrayContaining([
      'soul_version_saved',
      'source_deleted',
      'world_deleted',
      'persona_deleted',
    ]))
    expect(audit.every(event => !JSON.stringify(event.details).includes('临时正文'))).toBe(true)
  })
})
