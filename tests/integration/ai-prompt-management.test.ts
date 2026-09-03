import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { SqliteAiPromptRepository } from '../../server/infrastructure/database/SqliteAiPromptRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'

/** 当前测试独占的数据目录。 */
let temporaryDirectory: string
/** 当前测试数据库。 */
let database: SqliteDatabase
/** 被验证的提示词服务。 */
let service: AiPromptApplicationService
/** 测试使用的单调时间。 */
let timestamp: number

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-ai-prompts-test-'))
  database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  timestamp = 2_000_000_000_000
  service = new AiPromptApplicationService({
    repository: new SqliteAiPromptRepository(database.getClient()),
    identifiers: { create: () => randomUUID() },
    clock: { now: () => timestamp++ },
  })
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('全站 AI 提示词目录', () => {
  it('迁移初始化全部固定提示词并能按变量契约渲染', async () => {
    const prompts = await service.listWorkspaces()

    expect(prompts).toHaveLength(23)
    expect(prompts.map(prompt => prompt.code)).toEqual(expect.arrayContaining([
      'analysis.persona_memory_extract',
      'analysis.persona_memory_synthesize',
      'distillation.analyze_persona',
      'generation.article',
      'generation.article_images',
    ]))
    const interestPrompt = prompts.find(prompt => prompt.code === 'generation.interest_assessment')
    expect(interestPrompt?.activeVersion?.versionNo).toBe(4)
    expect(interestPrompt?.activeVersion?.systemPromptTemplate).toContain('<已发布人物灵魂>{{personaPromptJson}}</已发布人物灵魂>')
    expect(interestPrompt?.activeVersion?.userPromptTemplate).not.toContain('{{personaPromptJson}}')
    expect(interestPrompt?.activeVersion?.userPromptTemplate).toContain('<附加提示词>{{sceneJson}}</附加提示词>')
    expect(interestPrompt?.variables.find(variable => variable.name === 'sceneJson')).toMatchObject({
      label: '附加提示词', description: 'JSON 字符串或 null',
      placement: 'user', trust: 'untrusted', encoding: 'json_string', cacheRole: 'volatile',
    })
    expect(interestPrompt?.variables.find(variable => variable.name === 'personaPromptJson')).toMatchObject({
      placement: 'system', trust: 'trusted', encoding: 'json_string', cacheRole: 'stable',
    })
    expect(interestPrompt?.versions.map(version => version.versionNo)).toEqual([4, 3, 2, 1])
    for (const code of ['generation.article', 'generation.text_block']) {
      const prompt = prompts.find(item => item.code === code)
      expect(prompt?.activeVersion?.versionNo).toBe(2)
      expect(prompt?.activeVersion?.systemPromptTemplate).toContain('<已发布人物灵魂>{{personaPromptJson}}</已发布人物灵魂>')
      expect(prompt?.activeVersion?.userPromptTemplate).not.toContain('{{personaPromptJson}}')
      expect(prompt?.versions.map(version => version.versionNo)).toEqual([2, 1])
    }
    expect(prompts
      .filter(prompt => ![
        'analysis.persona_memory_extract', 'generation.interest_assessment', 'generation.article',
        'generation.document_plan', 'generation.text_block', 'generation.image_block',
      ].includes(prompt.code))
      .every(prompt => prompt.activeVersion?.versionNo === 1 && prompt.versions.length === 1)).toBe(true)
    for (const prompt of prompts) {
      const variables = Object.fromEntries(prompt.variables.map(variable => [
        variable.name,
        variable.encoding === 'json_string' ? JSON.stringify(`测试-${variable.name}`) : `测试-${variable.name}`,
      ]))
      const rendered = await service.render(prompt.code, variables)
      expect(rendered.versionId).toBe(prompt.activeVersion?.id)
      expect(`${rendered.systemPrompt}${rendered.userPrompt}`).not.toContain('{{')
    }
  })

  it('草稿保存后不生效，发布后形成新版本并保留历史', async () => {
    const initial = (await service.listWorkspaces()).find(prompt => prompt.code === 'generation.world_draft')!
    const initialRendered = await service.render(initial.code, { promptJson: '"旧输入"' })
    const draft = await service.saveDraft(initial.code, {
      baseVersionId: initial.activeVersion!.id,
      systemPromptTemplate: `${initial.activeVersion!.systemPromptTemplate}\n补充一条可维护规则。`,
      userPromptTemplate: '<用户明确世界>{{promptJson}}</用户明确世界>',
      changeSummary: '补充世界草稿规则',
    })

    expect(draft.draft?.changeSummary).toBe('补充世界草稿规则')
    await expect(service.render(initial.code, { promptJson: '"旧输入"' })).resolves.toMatchObject({
      versionId: initialRendered.versionId,
      versionNo: 1,
    })

    const published = await service.publishDraft(initial.code, { expectedDraftUpdatedAt: draft.draft!.updatedAt })
    const current = (await service.listWorkspaces()).find(prompt => prompt.code === initial.code)!
    expect(published.versionNo).toBe(2)
    expect(current.draft).toBeNull()
    expect(current.versions.map(version => version.versionNo)).toEqual([2, 1])
    await expect(service.render(initial.code, { promptJson: '"新输入"' })).resolves.toMatchObject({
      versionId: published.id,
      versionNo: 2,
    })
    await expect(service.render(initial.code, { promptJson: '"旧任务输入"' }, initialRendered.versionId)).resolves.toMatchObject({
      versionId: initialRendered.versionId,
      versionNo: 1,
    })
    expect(database.getClient().prepare(`
      SELECT length(variable_contract_hash) AS hash_length FROM ai_prompt_versions WHERE id = ?
    `).get(published.id)).toEqual({ hash_length: 64 })
  })

  it('拒绝遗漏、未知或运行时不完整的模板变量', async () => {
    const initial = (await service.listWorkspaces()).find(prompt => prompt.code === 'generation.world_draft')!

    await expect(service.saveDraft(initial.code, {
      baseVersionId: initial.activeVersion!.id,
      systemPromptTemplate: initial.activeVersion!.systemPromptTemplate,
      userPromptTemplate: '<世界>{{unknown}}</世界>',
      changeSummary: '错误变量测试',
    })).rejects.toMatchObject({ code: 'AI_PROMPT_TEMPLATE_INVALID' })
    await expect(service.render(initial.code, {})).rejects.toMatchObject({ code: 'AI_PROMPT_VARIABLE_INVALID' })
    await expect(service.render(initial.code, { promptJson: '不是 JSON' }))
      .rejects.toMatchObject({ code: 'AI_PROMPT_VARIABLE_INVALID' })
  })

  it('变量位置违反稳定前缀契约时拒绝保存草稿', async () => {
    const initial = (await service.listWorkspaces()).find(prompt => prompt.code === 'generation.article')!
    const systemTemplate = initial.activeVersion!.systemPromptTemplate!.replace(
      '<已发布人物灵魂>{{personaPromptJson}}</已发布人物灵魂>',
      '',
    )
    const userTemplate = `${initial.activeVersion!.userPromptTemplate}\n<人物>{{personaPromptJson}}</人物>`

    await expect(service.saveDraft(initial.code, {
      baseVersionId: initial.activeVersion!.id,
      systemPromptTemplate: systemTemplate,
      userPromptTemplate: userTemplate,
      changeSummary: '错误移动稳定人物变量',
    })).rejects.toMatchObject({ code: 'AI_PROMPT_TEMPLATE_INVALID' })
  })

  it('历史渲染使用版本自身变量契约而不是可变定义', async () => {
    const initial = (await service.listWorkspaces()).find(prompt => prompt.code === 'generation.world_draft')!
    database.getClient().prepare(`
      UPDATE ai_prompts SET variables_json = json_insert(
        variables_json, '$[#]',
        json('{"name":"futureJson","label":"未来变量","description":"仅用于测试","placement":"user","trust":"untrusted","encoding":"json_string","cacheRole":"volatile"}')
      ) WHERE code = ?
    `).run(initial.code)

    await expect(service.render(initial.code, { promptJson: '"历史输入"' }, initial.activeVersion!.id))
      .resolves.toMatchObject({ versionId: initial.activeVersion!.id, versionNo: 1 })
  })
})
